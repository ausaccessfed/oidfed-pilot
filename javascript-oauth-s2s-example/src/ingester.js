import express from "express";
import { EntityType, verifyClientAssertion } from "@oidfed/core";
import { importJWK, SignJWT, jwtVerify } from "jose";
import { Leaf } from "@oidfed/leaf";
import { config } from "./config.js";
import { createIngesterFederation } from "./federation.js";
import { sendWebResponse, toWebRequest } from "./http.js";

const { leaf, trustAnchor, trustAnchors, storage, ingesterKeys } =
	await createIngesterFederation();
const app = express();
const tokenEndpoint = `${config.ingesterEntityId}/token`;
const accessTokenSigner = await importJWK(
	ingesterKeys.protocol.privateKey,
	"ES256",
);
const accessTokenVerifier = await importJWK(
	ingesterKeys.protocol.publicKey,
	"ES256",
);

function routePath(basePath, route) {
	return `${basePath}/${route}`;
}

function oauthError(response, status, error, description) {
	response.status(status).json({ error, error_description: description });
}

function isJwks(value) {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray(value.keys) &&
		value.keys.length > 0
	);
}

app.post(
	routePath(config.ingesterBasePath, "token"),
	express.urlencoded({ extended: false, limit: "10kb" }),
	async (request, response) => {
		response.set("Cache-Control", "no-store");
		response.set("Pragma", "no-cache");
		const {
			grant_type: grantType,
			client_id: clientId,
			client_assertion_type: assertionType,
			client_assertion: assertion,
			scope,
		} = request.body ?? {};
		if (
			grantType !== "client_credentials" ||
			typeof clientId !== "string" ||
			assertionType !==
				"urn:ietf:params:oauth:client-assertion-type:jwt-bearer" ||
			typeof assertion !== "string"
		) {
			return oauthError(
				response,
				400,
				"invalid_request",
				"Provide a client-credentials grant and a private_key_jwt assertion.",
			);
		}
		if (scope !== config.scope) {
			return oauthError(
				response,
				400,
				"invalid_scope",
				`The only supported scope is ${config.scope}.`,
			);
		}
		if (clientId !== config.senderEntityId) {
			return oauthError(response, 401, "invalid_client", "Client is not trusted.");
		}
		if (
			config.devMockAuth &&
			!(await trustAnchor.listSubordinates()).includes(clientId)
		) {
			return oauthError(response, 401, "invalid_client", "Client is not trusted.");
		}

		const discovery = await Leaf.discoverEntity(clientId, trustAnchors);
		if (!discovery.ok) {
			return oauthError(response, 401, "invalid_client", "Client is not trusted.");
		}
		const clientMetadata =
			discovery.value.resolvedMetadata[EntityType.OAuthClient];
		if (
			clientMetadata?.token_endpoint_auth_method !== "private_key_jwt" ||
			!Array.isArray(clientMetadata.grant_types) ||
			!clientMetadata.grant_types.includes("client_credentials") ||
			!isJwks(clientMetadata.jwks)
		) {
			return oauthError(
				response,
				401,
				"invalid_client",
				"Trusted client metadata does not support private_key_jwt.",
			);
		}

		const verified = await verifyClientAssertion(
			assertion,
			clientMetadata.jwks,
			tokenEndpoint,
			{ allowedAlgorithms: ["ES256"] },
		);
		if (
			!verified.ok ||
			verified.value.clientId !== clientId ||
			verified.value.jti === undefined
		) {
			return oauthError(
				response,
				401,
				"invalid_client",
				"Client assertion is invalid or has already expired.",
			);
		}
		const freshAssertion = await storage.replay.useJti({
			issuer: clientId,
			audience: tokenEndpoint,
			jti: verified.value.jti,
			expiresAt: verified.value.expiresAt,
		});
		if (!freshAssertion) {
			return oauthError(
				response,
				401,
				"invalid_client",
				"Client assertion has already been used.",
			);
		}

		const now = Math.floor(Date.now() / 1000);
		const expiresIn = config.accessTokenTtlSeconds;
		const accessToken = await new SignJWT({
			client_id: clientId,
			scope: config.scope,
		})
			.setProtectedHeader({
				alg: "ES256",
				typ: "at+jwt",
				kid: ingesterKeys.protocol.privateKey.kid,
			})
			.setIssuer(config.ingesterEntityId)
			.setSubject(clientId)
			.setAudience(config.ingesterEntityId)
			.setIssuedAt(now)
			.setExpirationTime(now + expiresIn)
			.setJti(crypto.randomUUID())
			.sign(accessTokenSigner);

		return response.json({
			access_token: accessToken,
			token_type: "Bearer",
			expires_in: expiresIn,
			scope: config.scope,
		});
	},
);

app.post(
	routePath(config.ingesterBasePath, "data"),
	express.json({ limit: "1mb", strict: true }),
	async (request, response) => {
		const authorization = request.get("authorization") ?? "";
		const match = /^Bearer (.+)$/i.exec(authorization);
		if (!match) {
			response.set("WWW-Authenticate", 'Bearer realm="s2s-ingester"');
			return response.status(401).json({ error: "Bearer token required." });
		}

		let claims;
		try {
			({ payload: claims } = await jwtVerify(match[1], accessTokenVerifier, {
				issuer: config.ingesterEntityId,
				audience: config.ingesterEntityId,
				algorithms: ["ES256"],
				clockTolerance: 5,
			}));
		} catch {
			response.set(
				"WWW-Authenticate",
				'Bearer realm="s2s-ingester", error="invalid_token"',
			);
			return response.status(401).json({ error: "Bearer token is invalid." });
		}
		if (
			claims.scope !== config.scope ||
			typeof claims.sub !== "string" ||
			claims.client_id !== claims.sub
		) {
			response.set(
				"WWW-Authenticate",
				`Bearer error="insufficient_scope", scope="${config.scope}"`,
			);
			return response.status(403).json({ error: "Token is not authorized." });
		}
		if (
			typeof request.body !== "object" ||
			request.body === null ||
			Array.isArray(request.body)
		) {
			return response.status(400).json({ error: "Expected a JSON object." });
		}

		const record = {
			received_at: new Date().toISOString(),
			sender: claims.sub,
			data: request.body,
		};
		return response.status(201).json({ accepted: true, record });
	},
);

app.get(routePath(config.ingesterBasePath, "health"), (_request, response) => {
	response.json({ status: "ok", service: "ingester" });
});

app.use(async (request, response) => {
	const host = request.headers.host;
	const pathname = new URL(
		request.originalUrl,
		`https://${host}`,
	).pathname;
	const trustAnchorHost = new URL(config.trustAnchorEntityId).host;
	const ingesterHost = new URL(config.ingesterEntityId).host;
	const trustAnchorPath = new URL(config.trustAnchorEntityId).pathname.replace(
		/\/$/,
		"",
	);
	const isTrustAnchorPath =
		trustAnchorPath !== "" &&
		(pathname === trustAnchorPath ||
			pathname.startsWith(`${trustAnchorPath}/`));
	const handler =
		config.devMockAuth &&
		host === trustAnchorHost &&
		(trustAnchorHost !== ingesterHost || isTrustAnchorPath)
			? (incoming) => trustAnchor.handleRequest(incoming)
			: host === ingesterHost
				? (incoming) => leaf.handleRequest(incoming)
				: undefined;
	if (!handler) return response.status(421).send("Unknown service host.");
	return sendWebResponse(await handler(toWebRequest(request)), response);
});

app.listen(config.ingesterPort, config.serviceBindAddress, () => {
	console.log(
		`Ingester listening on ${config.serviceBindAddress}:${config.ingesterPort}`,
	);
});

import express from "express";
import { Leaf } from "@oidfed/leaf";
import { OAuthClientRole } from "@oidfed/oidc";
import { config } from "./config.js";
import { createSenderFederation } from "./federation.js";
import { sendWebResponse, toWebRequest } from "./http.js";

const { leaf, signer, trustAnchors } = await createSenderFederation();
const app = express();

async function sendToIngester(data) {
	const discovery = await Leaf.discoverEntity(
		config.ingesterEntityId,
		trustAnchors,
	);
	if (!discovery.ok) {
		throw new Error(
			`Could not discover a trusted ingester: ${discovery.error.description}`,
		);
	}
	const metadata =
		discovery.value.resolvedMetadata.oauth_authorization_server;
	if (
		metadata?.issuer !== config.ingesterEntityId ||
		metadata.token_endpoint !== `${config.ingesterEntityId}/token` ||
		!Array.isArray(metadata.grant_types_supported) ||
		!metadata.grant_types_supported.includes("client_credentials") ||
		!Array.isArray(metadata.token_endpoint_auth_methods_supported) ||
		!metadata.token_endpoint_auth_methods_supported.includes("private_key_jwt") ||
		!Array.isArray(metadata.scopes_supported) ||
		!metadata.scopes_supported.includes(config.scope)
	) {
		throw new Error("Trusted ingester metadata has no valid token endpoint.");
	}

	const assertion = await OAuthClientRole.createClientAssertion(
		config.senderEntityId,
		metadata.token_endpoint,
		signer,
		{ expiresInSeconds: config.clientAssertionTtlSeconds },
	);
	const tokenResponse = await fetch(metadata.token_endpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "client_credentials",
			client_id: config.senderEntityId,
			client_assertion_type:
				"urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
			client_assertion: assertion,
			scope: config.scope,
		}),
	});
	const tokenBody = await tokenResponse.json();
	if (
		!tokenResponse.ok ||
		typeof tokenBody.access_token !== "string" ||
		tokenBody.token_type !== "Bearer"
	) {
		throw new Error(
			`Ingester token request failed (${tokenResponse.status}): ${tokenBody.error_description ?? tokenBody.error ?? "invalid response"}`,
		);
	}

	const ingestResponse = await fetch(`${config.ingesterEntityId}/data`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${tokenBody.access_token}`,
			"content-type": "application/json",
		},
		body: JSON.stringify(data),
	});
	const ingestBody = await ingestResponse.json();
	if (!ingestResponse.ok) {
		throw new Error(
			`Ingester rejected the data (${ingestResponse.status}): ${JSON.stringify(ingestBody)}`,
		);
	}
	return ingestBody;
}

app.post(
	`${config.senderBasePath}/send`,
	express.json({ limit: "1mb", strict: true }),
	async (request, response) => {
		if (
			typeof request.body !== "object" ||
			request.body === null ||
			Array.isArray(request.body)
		) {
			return response.status(400).json({ error: "Expected a JSON object." });
		}
		try {
			const result = await sendToIngester(request.body);
			return response.status(201).json({ sent: true, result });
		} catch (error) {
			console.error("S2S transfer failed:", error);
			return response.status(502).json({
				error: "transfer_failed",
				error_description: error.message,
			});
		}
	},
);

app.get(`${config.senderBasePath}/health`, (_request, response) => {
	response.json({ status: "ok", service: "sender" });
});

app.use(async (request, response) => {
	if (request.headers.host !== new URL(config.senderEntityId).host) {
		return response.status(421).send("Unknown service host.");
	}
	return sendWebResponse(
		await leaf.handleRequest(toWebRequest(request)),
		response,
	);
});

app.listen(config.senderPort, config.serviceBindAddress, () => {
	console.log(
		`Sender listening on ${config.serviceBindAddress}:${config.senderPort}`,
	);
});

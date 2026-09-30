import { fileURLToPath } from "node:url";
import path from "node:path";
import {
	createTrustAnchorSet,
	EntityIdSchema,
	entityId,
	JWKSetSchema,
} from "@oidfed/core";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

function requiredEntityId(name, value) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${name} must be configured.`);
	}
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		value.endsWith("/") ||
		(url.pathname !== "/" && url.pathname.endsWith("/"))
	) {
		throw new Error(`${name} must be an HTTPS entity ID without query or fragment.`);
	}
	if (!EntityIdSchema.safeParse(value).success) {
		throw new Error(`${name} is not a valid federation entity ID.`);
	}
	return value;
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value, name) {
	try {
		return JSON.parse(value);
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`${name} is not valid JSON: ${error.message}`, {
				cause: error,
			});
		}
		throw error;
	}
}

function loadTrustAnchorConfigs() {
	const json = process.env.TRUST_ANCHORS_JSON;
	let values;
	if (json !== undefined) {
		values = parseJson(json, "TRUST_ANCHORS_JSON");
		if (!Array.isArray(values) || values.length === 0) {
			throw new Error("TRUST_ANCHORS_JSON must be a non-empty JSON array.");
		}
	} else {
		const anchorId = process.env.TRUST_ANCHOR_ENTITY_ID;
		const anchorJwks = process.env.TRUST_ANCHOR_JWKS;
		if (!anchorId || !anchorJwks) {
			throw new Error(
				"Set TRUST_ANCHORS_JSON or both TRUST_ANCHOR_ENTITY_ID and TRUST_ANCHOR_JWKS when DEV_MOCK_AUTH=false.",
			);
		}
		values = [
			{
				entityId: anchorId,
				jwks: parseJson(anchorJwks, "TRUST_ANCHOR_JWKS"),
			},
		];
	}

	const seen = new Set();
	return values.map((value, index) => {
		const context = `Trust anchor ${index + 1}`;
		if (!isRecord(value)) {
			throw new Error(`${context} must be a JSON object.`);
		}
		const anchorId = requiredEntityId(
			`${context} entityId`,
			value.entityId,
		);
		if (!EntityIdSchema.safeParse(anchorId).success) {
			throw new Error(`${context} entityId is invalid.`);
		}
		if (seen.has(anchorId)) {
			throw new Error(`Duplicate trust anchor entity ID: ${anchorId}`);
		}
		seen.add(anchorId);

		const jwks = JWKSetSchema.safeParse(value.jwks);
		if (!jwks.success) {
			throw new Error(`${context} jwks is invalid: ${jwks.error.message}`);
		}
		return { entityId: anchorId, jwks: jwks.data };
	});
}

function requiredPort(name, fallback) {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isInteger(value) || value < 1 || value > 65535) {
		throw new Error(`${name} must be a valid TCP port`);
	}
	return value;
}

const mockAuthValue = process.env.DEV_MOCK_AUTH ?? "false";
if (mockAuthValue !== "true" && mockAuthValue !== "false") {
	throw new Error("DEV_MOCK_AUTH must be either true or false.");
}
const devMockAuth = mockAuthValue === "true";
const localTrustAnchorEntityId = devMockAuth
	? requiredEntityId(
			"TRUST_ANCHOR_ENTITY_ID",
			process.env.TRUST_ANCHOR_ENTITY_ID ??
				"https://ta.s2s.dev.localhost:8443",
		)
	: undefined;
const externalTrustAnchors = devMockAuth ? [] : loadTrustAnchorConfigs();
const trustAnchorEntityIds = devMockAuth
	? [localTrustAnchorEntityId]
	: externalTrustAnchors.map((anchor) => anchor.entityId);
const trustAnchors = devMockAuth
	? undefined
	: createTrustAnchorSet(
			externalTrustAnchors.map((anchor) => ({
				entityId: entityId(anchor.entityId),
				jwks: anchor.jwks,
			})),
		);
const ingesterEntityId = requiredEntityId(
	"INGESTER_ENTITY_ID",
	process.env.INGESTER_ENTITY_ID ??
		"https://ingester.s2s.dev.localhost:8443",
);
const senderEntityId = requiredEntityId(
	"SENDER_ENTITY_ID",
	process.env.SENDER_ENTITY_ID ?? "https://sender.s2s.dev.localhost:8443",
);

export const config = Object.freeze({
	devMockAuth,
	trustAnchorEntityId: trustAnchorEntityIds[0],
	trustAnchorEntityIds,
	trustAnchors,
	ingesterEntityId,
	ingesterBasePath:
		new URL(ingesterEntityId).pathname === "/"
			? ""
			: new URL(ingesterEntityId).pathname,
	senderEntityId,
	senderBasePath:
		new URL(senderEntityId).pathname === "/"
			? ""
			: new URL(senderEntityId).pathname,
	ingesterPort: requiredPort("INGESTER_PORT", 4101),
	senderPort: requiredPort("SENDER_PORT", 4102),
	serviceBindAddress: process.env.SERVICE_BIND_ADDRESS ?? "127.0.0.1",
	keyDirectory: path.join(projectRoot, ".keys"),
	scope: "ingest:write",
	accessTokenTtlSeconds: 60,
	clientAssertionTtlSeconds: 60,
});

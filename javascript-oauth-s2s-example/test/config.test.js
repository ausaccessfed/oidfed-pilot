import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const configEnvNames = [
	"TRUST_ANCHORS_JSON",
	"TRUST_ANCHOR_ENTITY_ID",
	"TRUST_ANCHOR_JWKS",
	"INGESTER_ENTITY_ID",
	"SENDER_ENTITY_ID",
];

function runConfig(overrides = {}) {
	const env = { ...process.env, ...overrides };
	for (const name of configEnvNames) {
		if (!(name in overrides)) delete env[name];
	}
	return spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			'import { config } from "./src/config.js"; console.log(`${config.devMockAuth}:${config.trustAnchorEntityIds[0]}:${config.ingesterEntityId}:${config.senderEntityId}`);',
		],
		{ cwd: projectRoot, env, encoding: "utf8" },
	);
}

test("development mode selects the embedded local Trust Anchor", () => {
	const result = runConfig({ DEV_MOCK_AUTH: "true" });

	assert.equal(result.status, 0, result.stderr);
	assert.equal(
		result.stdout.trim(),
		"true:https://ta.s2s.dev.localhost:8443:https://ingester.s2s.dev.localhost:8443:https://sender.s2s.dev.localhost:8443",
	);
});

test("real mode accepts a configured Trust Anchor and JWKS", () => {
	const jwks = {
		keys: [
			{
				kty: "EC",
				crv: "P-256",
				alg: "ES256",
				use: "sig",
				kid: "fixture",
				x: "hh5u_VrRXLaXNAdZX2CQWNAXFqgDCYhYGY1y1qbx9Q8",
				y: "qNPeoZOuVv-I6e-oUt9imwV6TSt-ymTaaW2Mrlgo0JQ",
			},
		],
	};
	const result = runConfig({
		DEV_MOCK_AUTH: "false",
		TRUST_ANCHOR_ENTITY_ID: "https://ta.example.test",
		TRUST_ANCHOR_JWKS: JSON.stringify(jwks),
	});

	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), "false:https://ta.example.test:https://ingester.s2s.dev.localhost:8443:https://sender.s2s.dev.localhost:8443");
});

test("real mode fails without explicit Trust Anchor configuration", () => {
	const result = runConfig({ DEV_MOCK_AUTH: "false" });

	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Set TRUST_ANCHORS_JSON or both TRUST_ANCHOR_ENTITY_ID and TRUST_ANCHOR_JWKS/);
});

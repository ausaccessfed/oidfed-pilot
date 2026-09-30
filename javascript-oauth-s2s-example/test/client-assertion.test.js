import assert from "node:assert/strict";
import test from "node:test";
import {
	generateSigningKey,
	JwkSigner,
	MemoryReplayStore,
	verifyClientAssertion,
} from "@oidfed/core";
import { OAuthClientRole } from "@oidfed/oidc";

test("private_key_jwt assertions verify and cannot be replayed", async () => {
	const clientId = "https://sender.example.test";
	const audience = "https://ingester.example.test/token";
	const keys = await generateSigningKey("ES256");
	const assertion = await OAuthClientRole.createClientAssertion(
		clientId,
		audience,
		new JwkSigner(keys.privateKey),
	);
	const verified = await verifyClientAssertion(
		assertion,
		{ keys: [keys.publicKey] },
		audience,
		{ allowedAlgorithms: ["ES256"] },
	);

	assert.equal(verified.ok, true);
	if (!verified.ok) return;
	assert.equal(verified.value.clientId, clientId);
	assert.ok(verified.value.jti);

	const replayStore = new MemoryReplayStore();
	const replayClaim = {
		issuer: clientId,
		audience,
		jti: verified.value.jti,
		expiresAt: verified.value.expiresAt,
	};
	assert.equal(await replayStore.useJti(replayClaim), true);
	assert.equal(await replayStore.useJti(replayClaim), false);
});

test("private_key_jwt assertions reject a different audience", async () => {
	const keys = await generateSigningKey("ES256");
	const assertion = await OAuthClientRole.createClientAssertion(
		"https://sender.example.test",
		"https://ingester.example.test/token",
		new JwkSigner(keys.privateKey),
	);
	const verified = await verifyClientAssertion(
		assertion,
		{ keys: [keys.publicKey] },
		"https://other.example.test/token",
		{ allowedAlgorithms: ["ES256"] },
	);

	assert.equal(verified.ok, false);
});

import {
	createFederationSigningKey,
	MemoryFederationKeyProvider,
	JwkSigner,
} from "@oidfed/core";
import { MemoryStorageAdapter } from "@oidfed/authority";
import { Leaf } from "@oidfed/leaf";
import {
	OAuthAuthorizationServerRole,
	OAuthClientRole,
	OAuthResourceRole,
	StaticProtocolSigningKeyProvider,
} from "@oidfed/oidc";
import { config } from "./config.js";
import { loadKeys } from "./keys.js";
import { createLocalAnchor, loadLocalTrustAnchors } from "./local-anchor.js";

export async function createIngesterFederation() {
	const [ingesterKeys, senderKeys] = await Promise.all([
		loadKeys("ingester"),
		loadKeys("sender"),
	]);
	const storage = new MemoryStorageAdapter();
	let trustAnchor;
	let trustAnchors = config.trustAnchors;
	if (config.devMockAuth) {
		const localAnchor = await createLocalAnchor(
			storage,
			ingesterKeys,
			senderKeys,
		);
		trustAnchor = localAnchor.trustAnchor;
		trustAnchors = localAnchor.trustAnchors;
	}
	if (!trustAnchors) {
		throw new Error("No OpenID Federation Trust Anchor is configured.");
	}
	const ingesterProtocolJwks = { keys: [ingesterKeys.protocol.publicKey] };
	const authorizationServer = new OAuthAuthorizationServerRole({
		metadata: {
			issuer: config.ingesterEntityId,
			token_endpoint: `${config.ingesterEntityId}/token`,
			token_endpoint_auth_methods_supported: ["private_key_jwt"],
			token_endpoint_auth_signing_alg_values_supported: ["ES256"],
			grant_types_supported: ["client_credentials"],
			scopes_supported: [config.scope],
			jwks: ingesterProtocolJwks,
		},
		trustAnchors,
	});
	const resource = new OAuthResourceRole({
		metadata: {
			resource: config.ingesterEntityId,
			scopes_supported: [config.scope],
		},
		jwks: ingesterProtocolJwks,
	});
	const leaf = new Leaf({
		entityId: config.ingesterEntityId,
		authorityHints: config.trustAnchorEntityIds,
		trustAnchors,
		keyProvider: new MemoryFederationKeyProvider(
			createFederationSigningKey(ingesterKeys.federation.privateKey),
		),
		metadata: {
			federation_entity: {
				organization_name: "S2S Demo Ingester",
			},
		},
		roles: [authorizationServer, resource],
	});

	return {
		leaf,
		trustAnchor,
		trustAnchors,
		storage,
		ingesterKeys,
	};
}

export async function createSenderFederation() {
	const keys = await loadKeys("sender");
	const signer = new JwkSigner(keys.protocol.privateKey);
	const client = new OAuthClientRole({
		protocolKeyProvider: new StaticProtocolSigningKeyProvider({
			requestObjectSigner: signer,
			clientAssertionSigner: signer,
		}),
		metadata: {
			client_id: config.senderEntityId,
			client_name: "S2S Demo Sender",
			token_endpoint_auth_method: "private_key_jwt",
			token_endpoint_auth_signing_alg: "ES256",
			grant_types: ["client_credentials"],
			jwks: { keys: [keys.protocol.publicKey] },
		},
	});
	const leaf = new Leaf({
		entityId: config.senderEntityId,
		authorityHints: config.trustAnchorEntityIds,
		keyProvider: new MemoryFederationKeyProvider(
			createFederationSigningKey(keys.federation.privateKey),
		),
		metadata: {
			federation_entity: {
				organization_name: "S2S Demo Sender",
			},
		},
		roles: [client],
	});
	let trustAnchors = config.trustAnchors;
	if (config.devMockAuth) {
		trustAnchors = await loadLocalTrustAnchors();
	}
	if (!trustAnchors) {
		throw new Error("No OpenID Federation Trust Anchor is configured.");
	}

	return { leaf, signer, trustAnchors };
}

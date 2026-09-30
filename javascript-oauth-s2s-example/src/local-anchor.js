import {
	createFederationSigningKey,
	createTrustAnchorSet,
	EntityType,
	MemoryFederationKeyProvider,
} from "@oidfed/core";
import { TrustAnchor } from "@oidfed/authority";
import { config } from "./config.js";
import { loadKeys } from "./keys.js";

export async function createLocalAnchor(storage, ingesterKeys, senderKeys) {
	const rootKeys = await loadKeys("trust-anchor");
	const keyProvider = new MemoryFederationKeyProvider(
		createFederationSigningKey(rootKeys.federation.privateKey),
	);
	const trustAnchor = new TrustAnchor({
		entityId: config.trustAnchorEntityId,
		metadata: {
			federation_entity: {
				organization_name: "Local S2S Demo Federation",
				federation_fetch_endpoint: `${config.trustAnchorEntityId}/federation_fetch`,
				federation_list_endpoint: `${config.trustAnchorEntityId}/federation_list`,
				federation_resolve_endpoint: `${config.trustAnchorEntityId}/federation_resolve`,
			},
		},
		keyProvider,
		storage,
	});

	await Promise.all([
		trustAnchor.registerSubordinate({
			entityId: config.ingesterEntityId,
			jwks: { keys: [ingesterKeys.federation.publicKey] },
			entityTypes: [
				EntityType.FederationEntity,
				EntityType.OAuthAuthorizationServer,
				EntityType.OAuthResource,
			],
		}),
		trustAnchor.registerSubordinate({
			entityId: config.senderEntityId,
			jwks: { keys: [senderKeys.federation.publicKey] },
			entityTypes: [EntityType.FederationEntity, EntityType.OAuthClient],
		}),
	]);

	const jwks = (await keyProvider.getFederationKeySet()).jwks;
	return {
		trustAnchor,
		trustAnchors: createTrustAnchorSet([
			{ entityId: config.trustAnchorEntityId, jwks },
		]),
	};
}

export async function loadLocalTrustAnchors() {
	const rootKeys = await loadKeys("trust-anchor");
	return createTrustAnchorSet([
		{
			entityId: config.trustAnchorEntityId,
			jwks: { keys: [rootKeys.federation.publicKey] },
		},
	]);
}

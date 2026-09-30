import {
  createFederationSigningKey,
  entityId,
  JwkSigner,
  MemoryFederationKeyProvider,
} from "@oidfed/core";
import { Leaf } from "@oidfed/leaf";
import {
  OidcRelyingPartyRole,
  StaticProtocolSigningKeyProvider,
} from "@oidfed/oidc";
import {
  AAF_INTERMEDIATE_ENTITY_ID,
  callbackUrl,
  clientName,
  entityDisplayName,
  federationEntityConfig,
  organizationName,
  relyingPartyConfig,
  requestedScope,
  rpEntityId,
} from "../../config/environment.js";
import { loadOrCreateKeys } from "./federation.js";

export async function createRelyingParty() {
  const keys = await loadOrCreateKeys();
  const signer = new JwkSigner(keys.protocol.privateKey);
  const role = new OidcRelyingPartyRole({
    protocolKeyProvider: new StaticProtocolSigningKeyProvider({
      requestObjectSigner: signer,
      clientAssertionSigner: signer,
    }),
    requestDelivery: "query",
    metadata: {
      ...relyingPartyConfig,
      client_name: clientName,
      display_name: relyingPartyConfig.display_name ?? entityDisplayName,
      scope: requestedScope,
      redirect_uris: [callbackUrl],
      response_types: ["code"],
      grant_types: ["authorization_code"],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_signing_alg: "ES256",
      client_registration_types: ["automatic"],
      jwks: { keys: [keys.protocol.publicKey] },
    },
  });
  const leaf = new Leaf({
    entityId: rpEntityId,
    authorityHints: [entityId(AAF_INTERMEDIATE_ENTITY_ID)],
    keyProvider: new MemoryFederationKeyProvider(
      createFederationSigningKey(keys.federation.privateKey),
    ),
    metadata: {
      federation_entity: {
        ...federationEntityConfig,
        organization_name: organizationName,
        display_name: entityDisplayName,
      },
    },
    roles: [role],
  });
  return { leaf, role };
}

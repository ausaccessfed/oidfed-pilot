import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConcurrencyLimiter,
  createTrustAnchorSet,
  entityId,
  FederationMetadataPolicySchema,
  PolicyOperator,
} from "@oidfed/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(__dirname, "..");
function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Set ${name} in the environment.`);
  }
  return value;
}

export const AAF_INTERMEDIATE_ENTITY_ID = requireEnv("AAF_INTERMEDIATE_ENTITY_ID");
export const AAF_LIST_ENDPOINT = requireEnv("AAF_LIST_ENDPOINT");
export const FEDERATION_LIST_ENDPOINT = requireEnv("FEDERATION_LIST_ENDPOINT");
export const ENTITY_COLLECTION_ENDPOINT = process.env.ENTITY_COLLECTION_ENDPOINT;
export const devMockAuthEnabled =
  process.env.NODE_ENV === "development" && process.env.DEV_MOCK_AUTH === "true";
export const devMockProviderEntityId = "https://idp.demo.test";
export const devMockProfile = {
  subject: "demo-researcher-001",
  name: "Demo Researcher",
  email: "demo.researcher@example.test",
  emailVerified: true,
  issuer: devMockProviderEntityId,
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, message) {
  if (!isRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function parseJson(value, context) {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${context}: ${error.message}`, { cause: error });
    }
    throw error;
  }
}

function assertString(value, message) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function requireHttpsOrigin(value, name) {
  const origin = value.replace(/\/+$/, "");
  if (!origin) {
    throw new Error(`Set ${name} to the HTTPS origin where this RP will be hosted.`);
  }
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== "https:") {
    throw new Error(`${name} must be an HTTPS origin without a path or trailing slash.`);
  }
  return origin;
}

function requireHttpsUrl(value, name) {
  if (new URL(value).protocol !== "https:") {
    throw new Error(`${name} must use HTTPS.`);
  }
}
export const federationEntityConfig = {};
export const relyingPartyConfig = {};
const configuredProviderMetadataPolicy =
  process.env.PROVIDER_METADATA_POLICY === undefined
    ? {}
    : parseJson(process.env.PROVIDER_METADATA_POLICY, "PROVIDER_METADATA_POLICY");
const policyValidation = FederationMetadataPolicySchema.safeParse(configuredProviderMetadataPolicy);
if (!policyValidation.success) {
  throw new Error(`Invalid providerMetadataPolicy: ${policyValidation.error.message}`);
}
export const providerMetadataPolicy = policyValidation.data;

const supportedPolicyOperators = new Set(Object.values(PolicyOperator));
const unsupportedPolicyOperators = [];
for (const [entityType, parameters] of Object.entries(providerMetadataPolicy)) {
  for (const [parameter, operators] of Object.entries(parameters)) {
    for (const operator of Object.keys(operators)) {
      if (!supportedPolicyOperators.has(operator)) {
        unsupportedPolicyOperators.push(`${entityType}.${parameter}.${operator}`);
      }
    }
  }
}
if (unsupportedPolicyOperators.length) {
  throw new Error(`Unsupported provider metadata policy operators: ${unsupportedPolicyOperators.join(", ")}`);
}

function loadTrustAnchors() {
  const configuredTrustAnchors = process.env.TRUST_ANCHORS_JSON;
  if (configuredTrustAnchors !== undefined) {
    const parsedTrustAnchors = parseJson(configuredTrustAnchors, "TRUST_ANCHORS_JSON");
    if (!Array.isArray(parsedTrustAnchors) || parsedTrustAnchors.length === 0) {
      throw new Error("TRUST_ANCHORS_JSON must contain a non-empty JSON array.");
    }
    return parsedTrustAnchors.map((entry, index) => {
      if (!isRecord(entry)) {
        throw new Error(`TRUST_ANCHORS_JSON entry ${index + 1} must be a JSON object.`);
      }
      if (typeof entry.entityId !== "string" || !entry.entityId.trim()) {
        throw new Error(`TRUST_ANCHORS_JSON entry ${index + 1} must include a non-empty entityId string.`);
      }
      if (!isRecord(entry.jwks)) {
        throw new Error(`TRUST_ANCHORS_JSON entry ${index + 1} must include a jwks object.`);
      }
      return { entityId: entry.entityId, jwks: entry.jwks };
    });
  }

  const trustAnchorEntityId = requireEnv("TRUST_ANCHOR_ENTITY_ID");
  const trustAnchorJwks = parseJson(requireEnv("TRUST_ANCHOR_JWKS"), "TRUST_ANCHOR_JWKS");
  return [
    {
      entityId: trustAnchorEntityId,
      jwks: assertRecord(trustAnchorJwks, "TRUST_ANCHOR_JWKS must contain a JSON object."),
    },
  ];
}

const trustAnchorConfigs = loadTrustAnchors();
export const primaryTrustAnchorEntityId = trustAnchorConfigs[0].entityId;
export const trustAnchors = createTrustAnchorSet(
  trustAnchorConfigs.map(({ entityId: trustAnchorEntityId, jwks }) => ({
    entityId: entityId(trustAnchorEntityId),
    jwks,
  })),
);

export const appOrigin = requireHttpsOrigin(requireEnv("APP_ORIGIN"), "APP_ORIGIN");
requireHttpsUrl(FEDERATION_LIST_ENDPOINT, "FEDERATION_LIST_ENDPOINT");
if (ENTITY_COLLECTION_ENDPOINT) requireHttpsUrl(ENTITY_COLLECTION_ENDPOINT, "ENTITY_COLLECTION_ENDPOINT");

export const rpEntityId = entityId(appOrigin);
export const callbackUrl = `${appOrigin}/callback`;
export const organizationName = assertString(
  requireEnv("ORGANIZATION_NAME"),
  "ORGANIZATION_NAME must be a non-empty string.",
);
export const entityDisplayName = assertString(
  requireEnv("ENTITY_DISPLAY_NAME"),
  "ENTITY_DISPLAY_NAME must be a non-empty string.",
);
export const clientName = assertString(requireEnv("OIDC_CLIENT_NAME"), "OIDC_CLIENT_NAME must be a non-empty string.");
export const requestedScope = assertString(requireEnv("OIDC_SCOPE"), "OIDC_SCOPE must be a non-empty string.");
if (!requestedScope.trim().split(/\s+/).includes("openid")) {
  throw new Error("OIDC_SCOPE must be a non-empty space-separated list containing 'openid'.");
}

export const secureCookie = new URL(appOrigin).protocol === "https:";
export const cookieName = secureCookie ? "__Host-oidfed_session" : "oidfed_session";
export const sessionTtlMs = 8 * 60 * 60 * 1000;
export const keyDirectory = path.resolve(appRoot, requireEnv("KEY_DIRECTORY"));
export const keyFile = path.join(keyDirectory, "rp-keys.json");
export const providerMetadataLimit = createConcurrencyLimiter(6);
export const port = Number(requireEnv("PORT"));

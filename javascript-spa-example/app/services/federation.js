import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import {
  decodeEntityConfiguration,
  entityId,
  fetchEntityConfiguration,
  fetchListSubordinates,
  generateSigningKey,
  isOk,
} from "@oidfed/core";
import {
  ENTITY_COLLECTION_ENDPOINT,
  keyDirectory,
  keyFile,
  primaryTrustAnchorEntityId,
} from "../../config/environment.js";

export async function federationHttpClient(input, init) {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type");
  if (
    !contentType ||
    contentType.split(";", 1)[0].trim().toLowerCase() !== "application/entity-statement+jwt"
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/entity-statement+jwt");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function loadOrCreateKeys() {
  await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
  await chmod(keyDirectory, 0o700);
  try {
    const stored = JSON.parse(await readFile(keyFile, "utf8"));
    if (!stored.federation?.privateKey || !stored.protocol?.privateKey) {
      throw new Error(`Signing key file is incomplete: ${keyFile}`);
    }
    await chmod(keyFile, 0o600);
    return stored;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const federation = await generateSigningKey("ES256");
  const protocol = await generateSigningKey("ES256");
  const stored = { federation, protocol };
  await writeFile(keyFile, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return stored;
}

export async function describeProvider(rawEntityId) {
  const providerId = entityId(rawEntityId);
  const domain = new URL(providerId).hostname;
  const unavailable = {
    entityId: providerId,
    domain,
    displayName: domain,
    organizationName: "Organisation details unavailable",
    metadataAvailable: false,
  };
  const statementResult = await fetchEntityConfiguration(providerId, {
    httpClient: federationHttpClient,
  });
  if (!isOk(statementResult)) return unavailable;

  const decoded = decodeEntityConfiguration(statementResult.value);
  if (!isOk(decoded) || decoded.value.payload.sub !== providerId) return unavailable;

  const metadata = decoded.value.payload.metadata;
  const federationMetadata = metadata?.federation_entity;
  const providerMetadata = metadata?.openid_provider;
  const organizationNameValue =
    (typeof federationMetadata?.organization_name === "string" && federationMetadata.organization_name) ||
    (typeof federationMetadata?.display_name === "string" && federationMetadata.display_name) ||
    "Organisation name not published";
  const displayName =
    (typeof federationMetadata?.display_name === "string" && federationMetadata.display_name) ||
    (typeof providerMetadata?.display_name === "string" && providerMetadata.display_name) ||
    organizationNameValue;

  return {
    entityId: providerId,
    domain,
    displayName,
    organizationName: organizationNameValue,
    metadataAvailable: true,
  };
}

export async function fetchEntityCollectionProviders() {
  if (!ENTITY_COLLECTION_ENDPOINT) return undefined;

  const endpoint = new URL(ENTITY_COLLECTION_ENDPOINT);
  const providers = [];
  const cursors = new Set();
  let cursor;

  for (let page = 0; page < 1000; page += 1) {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.append("entity_type", "openid_provider");
    pageUrl.searchParams.append("trust_anchor", primaryTrustAnchorEntityId);
    if (cursor) pageUrl.searchParams.set("from", cursor);

    const response = await federationHttpClient(pageUrl);
    if (!response.ok || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
      throw new Error(`Entity Collection returned an unexpected response (${response.status}).`);
    }
    const pageData = await response.json();
    if (!Array.isArray(pageData.entities)) {
      throw new Error("Entity Collection response did not contain an entities array.");
    }
    for (const entry of pageData.entities) {
      if (!entry || typeof entry.entity_id !== "string") {
        throw new Error("Entity Collection returned an entity without an entity_id.");
      }
      providers.push(entityId(entry.entity_id));
    }
    if (pageData.next === undefined) return [...new Set(providers)];
    if (typeof pageData.next !== "string" || !pageData.next || cursors.has(pageData.next)) {
      throw new Error("Entity Collection returned an invalid pagination cursor.");
    }
    cursors.add(pageData.next);
    cursor = pageData.next;
  }
  throw new Error("Entity Collection exceeded the maximum number of pages.");
}

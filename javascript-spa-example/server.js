import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  createConcurrencyLimiter,
  createFederationSigningKey,
  createTrustAnchorSet,
  decodeEntityConfiguration,
  entityId,
  fetchEntityConfiguration,
  fetchListSubordinates,
  generateSigningKey,
  isOk,
  JwkSigner,
  MemoryFederationKeyProvider,
} from "@oidfed/core";
import { Leaf } from "@oidfed/leaf";
import {
  OidcRelyingPartyRole,
  StaticProtocolSigningKeyProvider,
} from "@oidfed/oidc";
import { createRemoteJWKSet, jwtVerify } from "jose";

const AAF_INTERMEDIATE_ENTITY_ID = "https://ta.dev.aaf.edu.au";
const AAF_LIST_ENDPOINT = "https://ta.dev.aaf.edu.au/list";
const FEDERATION_LIST_ENDPOINT = process.env.FEDERATION_LIST_ENDPOINT ?? AAF_LIST_ENDPOINT;
const ENTITY_COLLECTION_ENDPOINT = process.env.ENTITY_COLLECTION_ENDPOINT;
const TRUST_ANCHOR_ENTITY_ID = "https://ta.oidf-pilot.edugain.org";
const devMockAuthEnabled =
  process.env.NODE_ENV === "development" && process.env.DEV_MOCK_AUTH === "true";
const devMockProviderEntityId = "https://idp.demo.test";
const devMockProfile = {
  subject: "demo-researcher-001",
  name: "Demo Researcher",
  email: "demo.researcher@example.test",
  emailVerified: true,
  issuer: devMockProviderEntityId,
};
const TRUST_ANCHOR_JWKS = {
  keys: [
    {
      kty: "EC",
      crv: "P-256",
      alg: "ES256",
      use: "sig",
      kid: "xcXdyJ2_7cOd05QIqfpdrb3j5-mYFw8dqdcqzEh0lUw",
      x: "hh5u_VrRXLaXNAdZX2CQWNAXFqgDCYhYGY1y1qbx9Q8",
      y: "qNPeoZOuVv-I6e-oUt9imwV6TSt-ymTaaW2Mrlgo0JQ",
    },
  ],
};

const appOrigin = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");
if (!appOrigin) {
  throw new Error("Set APP_ORIGIN to the HTTPS origin where this RP will be hosted.");
}
const parsedOrigin = new URL(appOrigin);
if (parsedOrigin.origin !== appOrigin || parsedOrigin.protocol !== "https:") {
  throw new Error("APP_ORIGIN must be an HTTPS origin without a path or trailing slash.");
}
if (new URL(FEDERATION_LIST_ENDPOINT).protocol !== "https:") {
  throw new Error("FEDERATION_LIST_ENDPOINT must use HTTPS.");
}
if (ENTITY_COLLECTION_ENDPOINT && new URL(ENTITY_COLLECTION_ENDPOINT).protocol !== "https:") {
  throw new Error("ENTITY_COLLECTION_ENDPOINT must use HTTPS.");
}

const rpEntityId = entityId(appOrigin);
const callbackUrl = `${appOrigin}/callback`;
const trustAnchors = createTrustAnchorSet([
  { entityId: entityId(TRUST_ANCHOR_ENTITY_ID), jwks: TRUST_ANCHOR_JWKS },
]);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyDirectory = path.resolve(process.env.KEY_DIRECTORY ?? path.join(__dirname, ".keys"));
const keyFile = path.join(keyDirectory, "rp-keys.json");
const providerMetadataLimit = createConcurrencyLimiter(6);

async function federationHttpClient(input, init) {
  const response = await fetch(input, init);
  const contentType = response.headers.get("content-type");
  if (
    !contentType ||
    contentType.split(";", 1)[0].trim().toLowerCase() !== "application/entity-statement+jwt"
  ) {
    return response;
  }

  // The AAF OP adds charset=utf-8; entity-statement media type matching ignores parameters.
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/entity-statement+jwt");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function loadOrCreateKeys() {
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

const keys = await loadOrCreateKeys();
const protocolSigner = new JwkSigner(keys.protocol.privateKey);
const rpRole = new OidcRelyingPartyRole({
  protocolKeyProvider: new StaticProtocolSigningKeyProvider({
    requestObjectSigner: protocolSigner,
    clientAssertionSigner: protocolSigner,
  }),
  requestDelivery: "query",
  metadata: {
    client_name: "Federation Sign-in Demo",
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
      organization_name: process.env.ORGANIZATION_NAME ?? "Federation Sign-in Demo",
    },
  },
  roles: [rpRole],
});

const app = express();
const port = Number(process.env.PORT ?? 3000);
const secureCookie = parsedOrigin.protocol === "https:";
const cookieName = secureCookie ? "__Host-oidfed_session" : "oidfed_session";
const sessionTtlMs = 8 * 60 * 60 * 1000;
const sessions = new Map();

app.disable("x-powered-by");
app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  next();
});
app.use(express.json({ limit: "4kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(id);
  }
}, 60_000).unref();

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

function createSession(response) {
  const id = randomBytes(32).toString("base64url");
  sessions.set(id, { expiresAt: Date.now() + sessionTtlMs });
  const attributes = [
    `${cookieName}=${id}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`,
  ];
  if (secureCookie) attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
  return sessions.get(id);
}

function getSession(request, response) {
  const id = readCookie(request, cookieName);
  const current = id ? sessions.get(id) : undefined;
  if (!current || current.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return createSession(response);
  }
  current.expiresAt = Date.now() + sessionTtlMs;
  return current;
}

function clearSession(response, id) {
  if (id) sessions.delete(id);
  const attributes = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secureCookie) attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

function setFlow(session, phase, failureStep = null, error = null, details = null) {
  session.flow = {
    phase,
    providerEntityId: session.flow?.providerEntityId ?? null,
    failureStep,
    error,
    details,
  };
}

function publicFlow(session) {
  return {
    phase: session.flow?.phase ?? "idle",
    devMock: session.flow?.devMock ?? false,
    providerEntityId: session.flow?.providerEntityId ?? null,
    failureStep: session.flow?.failureStep ?? null,
    error: session.flow?.error ?? null,
    details: session.flow?.details ?? null,
  };
}

async function completeDevelopmentLogin(session, runId) {
  for (const phase of ["preparing_request", "awaiting_callback", "validating_response"]) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    if (session.devMockRunId !== runId) return;
    session.flow.phase = phase;
  }

  await new Promise((resolve) => setTimeout(resolve, 650));
  if (session.devMockRunId !== runId) return;
  session.profile = { ...devMockProfile };
  session.expiresAt = Date.now() + sessionTtlMs;
  session.flow.phase = "complete";
  delete session.devMockRunId;
}

async function describeProvider(rawEntityId) {
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
  const organizationName =
    (typeof federationMetadata?.organization_name === "string" && federationMetadata.organization_name) ||
    (typeof federationMetadata?.display_name === "string" && federationMetadata.display_name) ||
    "Organisation name not published";
  const displayName =
    (typeof federationMetadata?.display_name === "string" && federationMetadata.display_name) ||
    (typeof providerMetadata?.display_name === "string" && providerMetadata.display_name) ||
    organizationName;

  return {
    entityId: providerId,
    domain,
    displayName,
    organizationName,
    metadataAvailable: true,
  };
}

async function fetchEntityCollectionProviders() {
  if (!ENTITY_COLLECTION_ENDPOINT) return undefined;

  const endpoint = new URL(ENTITY_COLLECTION_ENDPOINT);
  const providers = [];
  const cursors = new Set();
  let cursor;

  for (let page = 0; page < 1000; page += 1) {
    const pageUrl = new URL(endpoint);
    pageUrl.searchParams.append("entity_type", "openid_provider");
    pageUrl.searchParams.append("trust_anchor", TRUST_ANCHOR_ENTITY_ID);
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

function requireSameOrigin(request, response, next) {
  if (request.get("origin") !== appOrigin) {
    response.status(403).json({ error: "Request origin was not accepted." });
    return;
  }
  next();
}

function randomValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

app.get("/.well-known/openid-federation", async (request, response) => {
  const federationResponse = await leaf.handleRequest(
    new Request(`${appOrigin}${request.originalUrl}`, { method: "GET" }),
  );
  response.status(federationResponse.status);
  response.setHeader(
    "Content-Type",
    federationResponse.headers.get("Content-Type") ?? "application/entity-statement+jwt",
  );
  response.send(await federationResponse.text());
});

app.get("/api/session", (request, response) => {
  const session = getSession(request, response);
  response.setHeader("Cache-Control", "no-store");
  response.json({
    authenticated: Boolean(session.profile),
    profile: session.profile ?? null,
    flow: publicFlow(session),
    devMockAuthEnabled,
    providers: session.flow?.phase === "choose_provider" ? session.providers ?? [] : [],
  });
});

if (devMockAuthEnabled) {
  app.post("/api/dev/login", requireSameOrigin, (request, response) => {
    const session = getSession(request, response);
    const runId = randomValue();
    session.profile = undefined;
    delete session.pending;
    session.devMockRunId = runId;
    session.flow = {
      phase: "discovering",
      devMock: true,
      providerEntityId: devMockProviderEntityId,
      failureStep: null,
      error: null,
      details: null,
    };
    response.setHeader("Cache-Control", "no-store");
    response.status(202).json({ flow: publicFlow(session) });
    void completeDevelopmentLogin(session, runId);
  });
}

app.get("/api/flow", (request, response) => {
  const session = getSession(request, response);
  response.setHeader("Cache-Control", "no-store");
  response.json(publicFlow(session));
});

app.post("/api/providers", requireSameOrigin, async (request, response) => {
  const session = getSession(request, response);
  session.profile = undefined;
  delete session.pending;
  delete session.devMockRunId;
  session.providerCandidates = [];
  session.providers = [];
  session.flow = { phase: "listing_providers", providerEntityId: null, failureStep: null, error: null };
  let uniqueIds;
  try {
    const collectionProviders = await fetchEntityCollectionProviders();
    if (collectionProviders) {
      uniqueIds = collectionProviders;
    } else {
      const listResult = await fetchListSubordinates(
        FEDERATION_LIST_ENDPOINT,
        { entityType: "openid_provider" },
        { httpClient: federationHttpClient },
      );
      if (!isOk(listResult)) throw new Error(listResult.error.description);
      uniqueIds = [...new Set(listResult.value)];
    }
  } catch (error) {
    console.error("Federation provider listing failed:", error);
    setFlow(session, "idle");
    response.status(502).json({
      error: "The identity provider directory could not be loaded. Check the federation listing endpoint and try again.",
    });
    return;
  }

  const providers = await Promise.all(
    uniqueIds.map((providerId) => providerMetadataLimit(() => describeProvider(providerId))),
  );
  session.providerCandidates = providers.map((provider) => provider.entityId);
  session.providers = providers;
  session.flow = { phase: "choose_provider", providerEntityId: null, failureStep: null, error: null };
  response.setHeader("Cache-Control", "no-store");
  response.json({ providers });
});

app.post("/api/login", requireSameOrigin, async (request, response) => {
  const selectedProvider = request.body?.entityId;
  const session = getSession(request, response);
  if (typeof selectedProvider !== "string" || !session.providerCandidates?.includes(selectedProvider)) {
    response.status(400).json({ error: "Select an identity provider from the federation directory." });
    return;
  }

  const opEntityId = entityId(selectedProvider);
  session.profile = undefined;
  delete session.pending;
  delete session.devMockRunId;
  session.flow = {
    phase: "discovering",
    providerEntityId: opEntityId,
    failureStep: null,
    error: null,
  };

  const discoveryResult = await Leaf.discoverEntity(opEntityId, trustAnchors, {
    httpClient: federationHttpClient,
    verboseErrors: true,
  });
  if (!isOk(discoveryResult)) {
    console.error("Federation discovery failed:", discoveryResult.error);
    const reason = String(discoveryResult.error.description).replace(/[\r\n]+/g, " ").slice(0, 240);
    setFlow(
      session,
      "error",
      "federation",
      "The identity provider could not be verified through the configured federation.",
      {
        whatWentWrong: reason,
        expected: "Every signed statement must be valid, unexpired, and lead through unique signing-key identifiers to the configured Trust Anchor.",
      },
    );
    response.status(502).json({ error: session.flow.error });
    return;
  }

  const discovery = discoveryResult.value;
  const providerMetadata = discovery.resolvedMetadata.openid_provider;
  if (!providerMetadata) {
    setFlow(
      session,
      "error",
      "federation",
      "The verified provider has no OpenID Connect metadata.",
      {
        whatWentWrong: "Federation trust was established, but the provider metadata has no OpenID Connect role.",
        expected: "The trusted provider must publish OpenID Connect metadata, including authorization and token endpoints.",
      },
    );
    response.status(502).json({ error: session.flow.error });
    return;
  }

  const issuer = providerMetadata.issuer;
  const tokenEndpoint = providerMetadata.token_endpoint;
  const jwksUri = providerMetadata.jwks_uri;
  const allowedAlgorithms = providerMetadata.id_token_signing_alg_values_supported;
  if (
    typeof issuer !== "string" ||
    typeof tokenEndpoint !== "string" ||
    typeof jwksUri !== "string" ||
    !Array.isArray(allowedAlgorithms)
  ) {
    setFlow(
      session,
      "error",
      "federation",
      "The verified provider metadata is incomplete.",
      {
        whatWentWrong: "One or more required provider fields are missing or have an invalid type.",
        expected: "The provider must publish its issuer, token endpoint, JWKS URI, and supported ID Token algorithms.",
      },
    );
    response.status(502).json({ error: session.flow.error });
    return;
  }

  const state = randomValue();
  const nonce = randomValue();
  const codeVerifier = randomValue(48);
  const challenge = createHash("sha256").update(codeVerifier).digest("base64url");

  setFlow(session, "preparing_request");
  const requestResult = await rpRole.createAuthorizationRequest(
    discovery,
    {
      client_id: rpEntityId,
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    },
    trustAnchors,
    { requestDelivery: "query", httpClient: federationHttpClient },
  );
  if (!isOk(requestResult)) {
    console.error("Authorization request creation failed:", requestResult.error);
    setFlow(
      session,
      "error",
      "request",
      "The signed sign-in request could not be created.",
      {
        whatWentWrong: String(requestResult.error.description).replace(/[\r\n]+/g, " ").slice(0, 240),
        expected: "The request must use verified provider metadata and a valid RP signing key.",
      },
    );
    response.status(502).json({ error: session.flow.error });
    return;
  }
  if (requestResult.value.delivery !== "query") {
    setFlow(
      session,
      "error",
      "request",
      "This sign-in request uses an unsupported delivery method.",
      {
        whatWentWrong: `The selected delivery method was ${requestResult.value.delivery}.`,
        expected: "This example is configured to use query delivery for the signed Request Object.",
      },
    );
    response.status(500).json({ error: session.flow.error });
    return;
  }

  session.pending = {
    state,
    nonce,
    codeVerifier,
    issuer,
    tokenEndpoint,
    jwksUri,
    allowedAlgorithms: allowedAlgorithms.filter(
      (algorithm) => typeof algorithm === "string" && /^(RS|PS|ES)(256|384|512)$/.test(algorithm),
    ),
  };
  session.flow = {
    phase: "ready",
    providerEntityId: opEntityId,
    failureStep: null,
    error: null,
    authorizationUrl: requestResult.value.authorizationUrl,
  };
  response.setHeader("Cache-Control", "no-store");
  response.json({ phase: "ready" });
});

app.post("/api/flow/continue", requireSameOrigin, (request, response) => {
  const session = getSession(request, response);
  const authorizationUrl = session.flow?.authorizationUrl;
  if (session.flow?.phase !== "ready" || typeof authorizationUrl !== "string") {
    response.status(409).json({ error: "The sign-in request is not ready. Start sign-in again." });
    return;
  }
  delete session.flow.authorizationUrl;
  session.flow.phase = "awaiting_callback";
  response.setHeader("Cache-Control", "no-store");
  response.json({ authorizationUrl });
});

app.get("/callback", async (request, response) => {
  const sessionId = readCookie(request, cookieName);
  const session = sessionId ? sessions.get(sessionId) : undefined;
  const pending = session?.pending;
  const returnedState = request.query.state;
  if (
    !session ||
    session.expiresAt <= Date.now() ||
    !pending ||
    typeof returnedState !== "string" ||
    !safeEqual(pending.state, returnedState)
  ) {
    response.status(400).send("Sign-in expired or the response state did not match. Please start again.");
    return;
  }
  delete session.pending;
  setFlow(session, "validating_response");

  if (typeof request.query.error === "string") {
    console.warn("Identity provider returned an authorization error:", request.query.error);
    setFlow(
      session,
      "error",
      "provider",
      "Your organisation did not complete sign-in. You can try again.",
      {
        whatWentWrong: "The identity provider returned an authorization error.",
        expected: "The identity provider should authenticate you and return an authorization code to this RP.",
      },
    );
    response.redirect("/?error=signin");
    return;
  }
  if (typeof request.query.code !== "string") {
    setFlow(
      session,
      "error",
      "response",
      "The identity provider did not return an authorization code.",
      {
        whatWentWrong: "The callback did not contain an authorization code.",
        expected: "A successful authorization-code flow returns a code and the matching state value.",
      },
    );
    response.redirect("/?error=signin");
    return;
  }

  try {
    const clientAssertion = await rpRole.createClientAssertion(pending.issuer);
    const tokenResponse = await fetch(pending.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: request.query.code,
        redirect_uri: callbackUrl,
        client_id: rpEntityId,
        code_verifier: pending.codeVerifier,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: clientAssertion,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!tokenResponse.ok) {
      console.error("Token endpoint returned status", tokenResponse.status);
      setFlow(
        session,
        "error",
        "response",
        "The authorization code could not be exchanged for tokens.",
        {
          whatWentWrong: `The token endpoint returned HTTP ${tokenResponse.status}.`,
          expected: "The OP should accept the code, PKCE verifier, and private_key_jwt client assertion.",
        },
      );
      response.redirect("/?error=signin");
      return;
    }

    const tokens = await tokenResponse.json();
    if (typeof tokens.id_token !== "string") {
      setFlow(
        session,
        "error",
        "response",
        "The identity provider did not return an ID Token.",
        {
          whatWentWrong: "The token response did not include an ID Token.",
          expected: "An OpenID Connect authorization-code response includes an ID Token for the authenticated user.",
        },
      );
      response.redirect("/?error=signin");
      return;
    }
    if (!pending.allowedAlgorithms.length) {
      setFlow(
        session,
        "error",
        "response",
        "No supported ID Token signing algorithm was advertised.",
        {
          whatWentWrong: "The provider does not advertise an asymmetric ID Token signing algorithm supported by this RP.",
          expected: "The provider advertises an asymmetric algorithm and publishes the corresponding public key in its JWKS.",
        },
      );
      response.redirect("/?error=signin");
      return;
    }

    const keySet = createRemoteJWKSet(new URL(pending.jwksUri), {
      timeoutDuration: 10_000,
      cooldownDuration: 30_000,
    });
    const { payload } = await jwtVerify(tokens.id_token, keySet, {
      issuer: pending.issuer,
      audience: rpEntityId,
      algorithms: pending.allowedAlgorithms,
    });
    if (payload.nonce !== pending.nonce || typeof payload.sub !== "string") {
      setFlow(
        session,
        "error",
        "response",
        "The ID Token did not match this sign-in request.",
        {
          whatWentWrong: "The token subject or nonce did not match the active sign-in transaction.",
          expected: "The ID Token must contain a subject and the nonce generated for this login.",
        },
      );
      response.redirect("/?error=signin");
      return;
    }

    session.profile = {
      subject: payload.sub,
      name: typeof payload.name === "string" ? payload.name : null,
      email: typeof payload.email === "string" ? payload.email : null,
      emailVerified: payload.email_verified === true,
      issuer: pending.issuer,
    };
    session.expiresAt = Date.now() + sessionTtlMs;
    setFlow(session, "complete");
    response.redirect("/");
  } catch (error) {
    console.error("OIDC callback validation failed:", error);
    setFlow(
      session,
      "error",
      "response",
      "The sign-in response could not be verified. Please try again.",
      {
        whatWentWrong: "The ID Token failed signature, issuer, audience, or expiry validation.",
        expected: "The token must be signed by a trusted provider key and match the discovered issuer and this RP as audience.",
      },
    );
    response.redirect("/?error=signin");
  }
});

app.post("/api/logout", requireSameOrigin, (request, response) => {
  const sessionId = readCookie(request, cookieName);
  clearSession(response, sessionId);
  response.setHeader("Cache-Control", "no-store");
  response.status(204).end();
});

app.listen(port, () => {
  console.log(`Federation sign-in app listening on port ${port}`);
  console.log(`RP Entity Identifier: ${rpEntityId}`);
  if (devMockAuthEnabled) {
    console.warn("Development mock sign-in is enabled; simulated identities are not authenticated users.");
  }
});

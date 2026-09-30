import { createHash } from "node:crypto";
import {
  applyMetadataPolicy,
  entityId,
  isOk,
} from "@oidfed/core";
import { Leaf } from "@oidfed/leaf";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  callbackUrl,
  cookieName,
  providerMetadataPolicy,
  rpEntityId,
  requestedScope,
  sessionTtlMs,
  trustAnchors,
} from "../../config/environment.js";
import {
  federationHttpClient,
} from "../services/federation.js";
import {
  getSession,
  readCookie,
  safeEqual,
  setFlow,
  sessions,
  randomValue,
} from "../models/session.js";

export function createAuthenticationController(rpRole) {
  async function login(request, response) {
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
      setFlow(session, "error", "federation",
        "The identity provider could not be verified through the configured federation.", {
          whatWentWrong: reason,
          expected: "Every signed statement must be valid, unexpired, and lead through unique signing-key identifiers to the configured Trust Anchor.",
        });
      response.status(502).json({ error: session.flow.error });
      return;
    }

    const discovery = discoveryResult.value;
    const policyResult = applyMetadataPolicy(discovery.resolvedMetadata, providerMetadataPolicy);
    if (!isOk(policyResult)) {
      console.error("Local provider metadata policy failed:", policyResult.error);
      const reason = String(policyResult.error.description).replace(/[\r\n]+/g, " ").slice(0, 240);
      setFlow(session, "error", "federation",
        "The identity provider's metadata did not satisfy this service's local policy.", {
          whatWentWrong: reason,
          expected: "The trusted provider metadata must also satisfy the local providerMetadataPolicy configured by this relying party.",
        });
      response.status(502).json({ error: session.flow.error });
      return;
    }

    const policyDiscovery = {
      ...discovery,
      resolvedMetadata: policyResult.value,
      trustChain: { ...discovery.trustChain, resolvedMetadata: policyResult.value },
    };
    const metadata = policyResult.value.openid_provider;
    if (!metadata) {
      setFlow(session, "error", "federation",
        "The verified provider has no OpenID Connect metadata.", {
          whatWentWrong: "Federation trust was established, but the provider metadata has no OpenID Connect role.",
          expected: "The trusted provider must publish OpenID Connect metadata, including authorization and token endpoints.",
        });
      response.status(502).json({ error: session.flow.error });
      return;
    }

    const { issuer, token_endpoint: tokenEndpoint, jwks_uri: jwksUri,
      id_token_signing_alg_values_supported: allowedAlgorithms } = metadata;
    if (typeof issuer !== "string" || typeof tokenEndpoint !== "string" ||
        typeof jwksUri !== "string" || !Array.isArray(allowedAlgorithms)) {
      setFlow(session, "error", "federation", "The verified provider metadata is incomplete.", {
        whatWentWrong: "One or more required provider fields are missing or have an invalid type.",
        expected: "The provider must publish its issuer, token endpoint, JWKS URI, and supported ID Token algorithms.",
      });
      response.status(502).json({ error: session.flow.error });
      return;
    }

    const state = randomValue();
    const nonce = randomValue();
    const codeVerifier = randomValue(48);
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    setFlow(session, "preparing_request");

    const requestResult = await rpRole.createAuthorizationRequest(
      policyDiscovery,
      {
        client_id: rpEntityId,
        redirect_uri: callbackUrl,
        response_type: "code",
        scope: requestedScope,
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
      setFlow(session, "error", "request", "The signed sign-in request could not be created.", {
        whatWentWrong: String(requestResult.error.description).replace(/[\r\n]+/g, " ").slice(0, 240),
        expected: "The request must use verified provider metadata and a valid RP signing key.",
      });
      response.status(502).json({ error: session.flow.error });
      return;
    }
    if (requestResult.value.delivery !== "query") {
      setFlow(session, "error", "request", "This sign-in request uses an unsupported delivery method.", {
        whatWentWrong: `The selected delivery method was ${requestResult.value.delivery}.`,
        expected: "This example is configured to use query delivery for the signed Request Object.",
      });
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
  }

  function continueFlow(request, response) {
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
  }

  async function callback(request, response) {
    const sessionId = readCookie(request, cookieName);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    const pending = session?.pending;
    const returnedState = request.query.state;
    if (!session || session.expiresAt <= Date.now() || !pending ||
        typeof returnedState !== "string" || !safeEqual(pending.state, returnedState)) {
      response.status(400).send("Sign-in expired or the response state did not match. Please start again.");
      return;
    }
    delete session.pending;
    setFlow(session, "validating_response");

    if (typeof request.query.error === "string") {
      console.warn("Identity provider returned an authorization error:", request.query.error);
      setFlow(session, "error", "provider", "Your organisation did not complete sign-in. You can try again.", {
        whatWentWrong: "The identity provider returned an authorization error.",
        expected: "The identity provider should authenticate you and return an authorization code to this RP.",
      });
      response.redirect("/?error=signin");
      return;
    }
    if (typeof request.query.code !== "string") {
      setFlow(session, "error", "response", "The identity provider did not return an authorization code.", {
        whatWentWrong: "The callback did not contain an authorization code.",
        expected: "A successful authorization-code flow returns a code and the matching state value.",
      });
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
        setFlow(session, "error", "response", "The authorization code could not be exchanged for tokens.", {
          whatWentWrong: `The token endpoint returned HTTP ${tokenResponse.status}.`,
          expected: "The OP should accept the code, PKCE verifier, and private_key_jwt client assertion.",
        });
        response.redirect("/?error=signin");
        return;
      }

      const tokens = await tokenResponse.json();
      if (typeof tokens.id_token !== "string") {
        setFlow(session, "error", "response", "The identity provider did not return an ID Token.", {
          whatWentWrong: "The token response did not include an ID Token.",
          expected: "An OpenID Connect authorization-code response includes an ID Token for the authenticated user.",
        });
        response.redirect("/?error=signin");
        return;
      }
      if (!pending.allowedAlgorithms.length) {
        setFlow(session, "error", "response", "No supported ID Token signing algorithm was advertised.", {
          whatWentWrong: "The provider does not advertise an asymmetric ID Token signing algorithm supported by this RP.",
          expected: "The provider advertises an asymmetric algorithm and publishes the corresponding public key in its JWKS.",
        });
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
        setFlow(session, "error", "response", "The ID Token did not match this sign-in request.", {
          whatWentWrong: "The token subject or nonce did not match the active sign-in transaction.",
          expected: "The ID Token must contain a subject and the nonce generated for this login.",
        });
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
      setFlow(session, "error", "response", "The sign-in response could not be verified. Please try again.", {
        whatWentWrong: "The ID Token failed signature, issuer, audience, or expiry validation.",
        expected: "The token must be signed by a trusted provider key and match the discovered issuer and this RP as audience.",
      });
      response.redirect("/?error=signin");
    }
  }

  return { login, continueFlow, callback };
}

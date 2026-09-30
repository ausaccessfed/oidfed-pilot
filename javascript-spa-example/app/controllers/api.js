import { decodeEntityConfiguration, fetchListSubordinates, isOk } from "@oidfed/core";
import {
  FEDERATION_LIST_ENDPOINT,
  appOrigin,
  devMockAuthEnabled,
  devMockProviderEntityId,
  providerMetadataLimit,
  providerMetadataPolicy,
  cookieName,
} from "../../config/environment.js";
import {
  describeProvider,
  fetchEntityCollectionProviders,
  federationHttpClient,
} from "../services/federation.js";
import {
  clearSession,
  completeDevelopmentLogin,
  getSession,
  publicFlow,
  randomValue,
  readCookie,
  setFlow,
} from "../models/session.js";

export function createApiController({ leaf }) {
  async function federationMetadata(request, response) {
    const result = await leaf.handleRequest(
      new Request(`${appOrigin}${request.originalUrl}`, { method: "GET" }),
    );
    response.status(result.status);
    response.setHeader(
      "Content-Type",
      result.headers.get("Content-Type") ?? "application/entity-statement+jwt",
    );
    response.send(await result.text());
  }

  async function serviceMetadata(request, response) {
    try {
      const result = await leaf.handleRequest(
        new Request(`${appOrigin}/.well-known/openid-federation`, { method: "GET" }),
      );
      if (!result.ok) throw new Error(`Entity Configuration returned HTTP ${result.status}.`);
      const decoded = decodeEntityConfiguration(await result.text());
      if (!isOk(decoded)) throw new Error(decoded.error.description);
      response.setHeader("Cache-Control", "no-store");
      response.json({ payload: decoded.value.payload });
    } catch (error) {
      console.error("Service metadata could not be loaded:", error);
      response.status(500).json({
        error: "The service's published federation metadata could not be loaded.",
      });
    }
  }

  function providerPolicy(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.json({ policy: providerMetadataPolicy });
  }

  function session(request, response) {
    const current = getSession(request, response);
    response.setHeader("Cache-Control", "no-store");
    response.json({
      authenticated: Boolean(current.profile),
      profile: current.profile ?? null,
      flow: publicFlow(current),
      devMockAuthEnabled,
      providers: current.flow?.phase === "choose_provider" ? current.providers ?? [] : [],
    });
  }

  function flow(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.json(publicFlow(getSession(request, response)));
  }

  function devLogin(request, response) {
    const current = getSession(request, response);
    const runId = randomValue();
    current.profile = undefined;
    delete current.pending;
    current.devMockRunId = runId;
    current.flow = {
      phase: "discovering",
      devMock: true,
      providerEntityId: devMockProviderEntityId,
      failureStep: null,
      error: null,
      details: null,
    };
    response.setHeader("Cache-Control", "no-store");
    response.status(202).json({ flow: publicFlow(current) });
    void completeDevelopmentLogin(current, runId);
  }

  async function providers(request, response) {
    const current = getSession(request, response);
    current.profile = undefined;
    delete current.pending;
    delete current.devMockRunId;
    current.providerCandidates = [];
    current.providers = [];
    current.flow = { phase: "listing_providers", providerEntityId: null, failureStep: null, error: null };

    let ids;
    try {
      const collectionProviders = await fetchEntityCollectionProviders();
      if (collectionProviders) {
        ids = collectionProviders;
      } else {
        const result = await fetchListSubordinates(
          FEDERATION_LIST_ENDPOINT,
          { entityType: "openid_provider" },
          { httpClient: federationHttpClient },
        );
        if (!isOk(result)) throw new Error(result.error.description);
        ids = [...new Set(result.value)];
      }
    } catch (error) {
      console.error("Federation provider listing failed:", error);
      setFlow(current, "idle");
      response.status(502).json({
        error: "The identity provider directory could not be loaded. Check the federation listing endpoint and try again.",
      });
      return;
    }

    const listedProviders = await Promise.all(
      ids.map((providerId) => providerMetadataLimit(() => describeProvider(providerId))),
    );
    current.providerCandidates = listedProviders.map((provider) => provider.entityId);
    current.providers = listedProviders;
    current.flow = { phase: "choose_provider", providerEntityId: null, failureStep: null, error: null };
    response.setHeader("Cache-Control", "no-store");
    response.json({ providers: listedProviders });
  }

  function logout(request, response) {
    clearSession(response, readCookie(request, cookieName));
    response.setHeader("Cache-Control", "no-store");
    response.status(204).end();
  }

  return {
    federationMetadata,
    serviceMetadata,
    providerPolicy,
    session,
    flow,
    devLogin,
    providers,
    logout,
  };
}

import express from "express";
import { devMockAuthEnabled } from "./environment.js";
import { requireSameOrigin } from "../app/middleware/security.js";

export function createRouter({ apiController, authenticationController }) {
  const router = express.Router();

  router.get("/.well-known/openid-federation", apiController.federationMetadata);
  router.get("/api/session", apiController.session);
  router.get("/api/service-metadata", apiController.serviceMetadata);
  router.get("/api/provider-metadata-policy", apiController.providerPolicy);
  if (devMockAuthEnabled) router.post("/api/dev/login", requireSameOrigin, apiController.devLogin);
  router.get("/api/flow", apiController.flow);
  router.post("/api/providers", requireSameOrigin, apiController.providers);
  router.post("/api/login", requireSameOrigin, authenticationController.login);
  router.post("/api/flow/continue", requireSameOrigin, authenticationController.continueFlow);
  router.get("/callback", authenticationController.callback);
  router.post("/api/logout", requireSameOrigin, apiController.logout);

  return router;
}

import path from "node:path";
import express from "express";
import { appRoot } from "../config/environment.js";
import { createRouter } from "../config/routes.js";
import { createApiController } from "./controllers/api.js";
import { createAuthenticationController } from "./controllers/authentication.js";
import { startSessionCleanup } from "./models/session.js";
import { createRelyingParty } from "./services/relyingParty.js";

export async function createApp() {
  const { leaf, role } = await createRelyingParty();
  const app = express();

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
  app.use(express.static(path.join(appRoot, "public"), { index: "index.html" }));
  app.use(createRouter({
    apiController: createApiController({ leaf }),
    authenticationController: createAuthenticationController(role),
  }));

  startSessionCleanup();
  return app;
}

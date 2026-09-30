import { appOrigin } from "../../config/environment.js";

export function requireSameOrigin(request, response, next) {
  if (request.get("origin") !== appOrigin) {
    response.status(403).json({ error: "Request origin was not accepted." });
    return;
  }
  next();
}

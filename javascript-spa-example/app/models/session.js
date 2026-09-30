import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  cookieName,
  devMockProfile,
  secureCookie,
  sessionTtlMs,
} from "../../config/environment.js";

export const sessions = new Map();
let cleanupTimer;

export function startSessionCleanup() {
  if (cleanupTimer) return cleanupTimer;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
  }, 60_000);
  cleanupTimer.unref();
  return cleanupTimer;
}

export function readCookie(request, name) {
  const cookieHeader = request.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function createSession(response) {
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

export function getSession(request, response) {
  const id = readCookie(request, cookieName);
  const current = id ? sessions.get(id) : undefined;
  if (!current || current.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return createSession(response);
  }
  current.expiresAt = Date.now() + sessionTtlMs;
  return current;
}

export function clearSession(response, id) {
  if (id) sessions.delete(id);
  const attributes = [`${cookieName}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secureCookie) attributes.push("Secure");
  response.setHeader("Set-Cookie", attributes.join("; "));
}

export function setFlow(session, phase, failureStep = null, error = null, details = null) {
  session.flow = {
    phase,
    providerEntityId: session.flow?.providerEntityId ?? null,
    failureStep,
    error,
    details,
  };
}

export function publicFlow(session) {
  return {
    phase: session.flow?.phase ?? "idle",
    devMock: session.flow?.devMock ?? false,
    providerEntityId: session.flow?.providerEntityId ?? null,
    failureStep: session.flow?.failureStep ?? null,
    error: session.flow?.error ?? null,
    details: session.flow?.details ?? null,
  };
}

export async function completeDevelopmentLogin(session, runId) {
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

export function randomValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

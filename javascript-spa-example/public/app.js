import { loadProviderMetadataPolicy, loadServiceMetadata } from "./metadata.js";
import { getSelectedProviderEntityId, renderFlow as renderFlowView } from "./flow.js";
import { renderProviders as renderProviderCards } from "./providers.js";

const signInPanel = document.querySelector("#sign-in");
const landingPanel = document.querySelector(".hero");
const researcherDashboard = document.querySelector("#researcher-dashboard");
const loginButton = document.querySelector("#login-button");
const devLoginButton = document.querySelector("#dev-login-button");
const devLoginNote = document.querySelector("#dev-login-note");
const environmentLabel = document.querySelector("#environment-label");
const serviceInfoButton = document.querySelector("#service-info-button");
const providerPolicyButton = document.querySelector("#provider-policy-button");
const serviceInfoScreen = document.querySelector("#service-info-screen");
const providerPolicyScreen = document.querySelector("#provider-policy-screen");
const logoutButton = document.querySelector("#logout-button");
const resetSessionButton = document.querySelector("#reset-session-button");
const errorMessage = document.querySelector("#error-message");
const providerDirectory = document.querySelector("#provider-directory");
const providerList = document.querySelector("#provider-list");
const directoryMessage = document.querySelector("#directory-message");
const directoryRetry = document.querySelector("#directory-retry");
const flowPanel = document.querySelector("#flow-panel");
const flowError = document.querySelector("#flow-error");
const continueButton = document.querySelector("#continue-button");
const retryButton = document.querySelector("#retry-button");
let sessionAuthenticated = false;
let pollTimer;
let loginStarting = false;
let activeScreen = "main";

function setActiveScreen(screen) {
  activeScreen = screen;
  const isMetadata = screen === "metadata";
  const isProviderPolicy = screen === "policy";
  landingPanel.hidden = screen !== "main" || sessionAuthenticated;
  researcherDashboard.hidden = screen !== "main" || !sessionAuthenticated;
  serviceInfoScreen.hidden = !isMetadata;
  providerPolicyScreen.hidden = !isProviderPolicy;
  if (isMetadata) serviceInfoButton.setAttribute("aria-current", "page");
  else serviceInfoButton.removeAttribute("aria-current");
  if (isProviderPolicy) providerPolicyButton.setAttribute("aria-current", "page");
  else providerPolicyButton.removeAttribute("aria-current");
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function showProfile(profile) {
  sessionAuthenticated = true;
  setActiveScreen(activeScreen);
  signInPanel.hidden = true;
  document.querySelector("#welcome-title").textContent = profile.name
    ? `Welcome, ${profile.name}`
    : "Welcome to your research workspace";
  document.querySelector("#profile-email").textContent = profile.email ?? profile.subject;
  document.querySelector("#avatar").textContent = (profile.name || profile.email || "A").slice(0, 1).toUpperCase();
  document.querySelector("#profile-issuer").textContent = profile.issuer
    ? new URL(profile.issuer).hostname
    : "Australian Access Federation";
  document.querySelector("#profile-email-status").textContent = profile.email
    ? profile.emailVerified ? "Email verified" : "Email verification not provided"
    : "No email shared";
  document.querySelector("#dashboard-profile-state").textContent = profile.name || profile.email
    ? "Profile loaded"
    : "Basic identity only";
}

async function requestProviders() {
  resetSessionButton.hidden = false;
  providerDirectory.hidden = false;
  flowPanel.hidden = true;
  signInPanel.hidden = true;
  providerList.replaceChildren();
  providerList.setAttribute("aria-busy", "true");
  directoryMessage.textContent = "Loading identity providers…";
  directoryMessage.hidden = false;
  directoryRetry.hidden = true;

  try {
    const response = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The provider directory could not be loaded.");
    renderProviderCards(result.providers, beginLogin);
  } catch (error) {
    providerList.setAttribute("aria-busy", "false");
    directoryMessage.textContent = error.message || "Check your connection and reload the provider directory.";
    directoryMessage.classList.add("directory-error");
    directoryRetry.hidden = false;
  }
}

async function refreshFlow() {
  const response = await fetch("/api/flow", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Sign-in progress could not be loaded.");
  const flow = await response.json();
  if (flow.phase !== "idle" || !loginStarting) renderFlowView(flow, sessionAuthenticated);
  if (!["discovering", "preparing_request"].includes(flow.phase)) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
  return flow;
}

async function beginLogin(providerEntityId) {
  loginStarting = true;
  providerDirectory.hidden = true;
  signInPanel.hidden = true;
  flowPanel.hidden = false;
  flowError.hidden = true;
  loginButton.disabled = true;
  loginButton.setAttribute("aria-busy", "true");
  renderFlowView({ phase: "discovering", providerEntityId }, sessionAuthenticated);
  pollTimer = window.setInterval(() => {
    refreshFlow().catch(() => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
      renderFlowView({
        phase: "error",
        failureStep: "federation",
        error: "Sign-in progress could not be updated. Check your connection and try again.",
      }, sessionAuthenticated);
    });
  }, 500);

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ entityId: providerEntityId }),
    });
    if (!response.ok) {
      const flow = await refreshFlow();
      if (["discovering", "preparing_request"].includes(flow.phase)) {
        renderFlowView({
          phase: "error",
          providerEntityId,
          failureStep: flow.phase === "discovering" ? "federation" : "request",
          error: "The server could not complete this step. Check the service status and try again.",
        }, sessionAuthenticated);
      }
      return;
    }
    await refreshFlow();
  } catch (error) {
    renderFlowView({
      phase: "error",
      providerEntityId,
      failureStep: "federation",
      error: error.message || "The sign-in flow could not start. Check your connection and try again.",
    }, sessionAuthenticated);
  } finally {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
    loginStarting = false;
    loginButton.disabled = false;
    loginButton.removeAttribute("aria-busy");
  }
}

async function loadSession() {
  const response = await fetch("/api/session", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Your session could not be loaded.");
  const session = await response.json();
  resetSessionButton.hidden = session.authenticated || session.flow.phase === "idle";
  devLoginButton.hidden = !session.devMockAuthEnabled || session.authenticated;
  devLoginNote.hidden = !session.devMockAuthEnabled || session.authenticated;
  if (session.devMockAuthEnabled) {
    environmentLabel.textContent = "Development mode · mock sign-in";
    environmentLabel.classList.add("environment-demo");
  }
  if (session.authenticated) showProfile(session.profile);
  if (session.flow.phase === "choose_provider") {
    renderProviderCards(session.providers, beginLogin);
  } else if (session.flow.phase === "listing_providers") {
    await requestProviders();
  } else {
    renderFlowView(session.flow, sessionAuthenticated);
  }
  if (!session.authenticated && session.flow.phase === "idle") {
    loginButton.disabled = false;
    loginButton.querySelector(".button-label").textContent = "Choose an organisation";
  }
}

loginButton.addEventListener("click", () => {
  errorMessage.hidden = true;
  requestProviders();
});

serviceInfoButton.addEventListener("click", () => {
  if (activeScreen === "metadata") {
    setActiveScreen("main");
    return;
  }
  setActiveScreen("metadata");
  loadServiceMetadata();
});

providerPolicyButton.addEventListener("click", () => {
  if (activeScreen === "policy") {
    setActiveScreen("main");
    return;
  }
  setActiveScreen("policy");
  loadProviderMetadataPolicy();
});

devLoginButton.addEventListener("click", async () => {
  resetSessionButton.hidden = false;
  devLoginButton.disabled = true;
  devLoginButton.setAttribute("aria-busy", "true");
  devLoginButton.textContent = "Simulating sign-in…";
  loginButton.disabled = true;
  try {
    const response = await fetch("/api/dev/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The demo sign-in could not start.");
    renderFlowView(result.flow, sessionAuthenticated);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const flowResponse = await fetch("/api/flow", { headers: { Accept: "application/json" } });
      if (!flowResponse.ok) throw new Error("The demo sign-in progress could not be loaded.");
      const flow = await flowResponse.json();
      renderFlowView(flow, sessionAuthenticated);
      if (flow.phase === "complete") {
        await loadSession();
        return;
      }
      if (flow.phase === "error") throw new Error(flow.error || "The demo sign-in failed.");
    }
    throw new Error("The demo sign-in took too long to complete.");
  } catch (error) {
    renderFlowView({
      phase: "error",
      devMock: true,
      failureStep: "start",
      error: error.message || "The demo sign-in could not be completed.",
    }, sessionAuthenticated);
  } finally {
    devLoginButton.disabled = false;
    devLoginButton.removeAttribute("aria-busy");
    devLoginButton.textContent = "Run development sign-in";
    loginButton.disabled = false;
  }
});

directoryRetry.addEventListener("click", requestProviders);

continueButton.addEventListener("click", async () => {
  continueButton.disabled = true;
  continueButton.setAttribute("aria-busy", "true");
  continueButton.querySelector(".button-label").textContent = "Opening your organisation’s sign-in…";
  try {
    const response = await fetch("/api/flow/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The request is no longer available. Try again.");
    renderFlowView({
      phase: "awaiting_callback",
      providerEntityId: getSelectedProviderEntityId(),
    }, sessionAuthenticated);
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    flowError.textContent = error.message;
    flowError.hidden = false;
    continueButton.disabled = false;
    continueButton.removeAttribute("aria-busy");
    continueButton.querySelector(".button-label").textContent = "Continue to your organisation";
  }
});

for (const trigger of flowPanel.querySelectorAll(".step-trigger")) {
  trigger.addEventListener("click", () => {
    if (trigger.disabled) return;
    const expanded = trigger.getAttribute("aria-expanded") !== "true";
    trigger.setAttribute("aria-expanded", String(expanded));
    trigger.querySelector(".step-hint").textContent = expanded ? "Hide details" : "View details";
    trigger.closest(".flow-step").querySelector(".step-details").hidden = !expanded;
  });
}

retryButton.addEventListener("click", requestProviders);

async function clearSession(button, busyLabel, idleLabel) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = busyLabel;
  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("Sign-out could not be completed.");
    window.location.assign("/");
  } catch (error) {
    showError(error.message);
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = idleLabel;
  }
}

logoutButton.addEventListener("click", () => clearSession(logoutButton, "Signing out…", "Sign out"));
resetSessionButton.addEventListener("click", () => {
  clearSession(resetSessionButton, "Resetting session…", "Reset session");
});

loadSession()
  .then(() => {
    if (new URLSearchParams(window.location.search).has("error")) {
      window.history.replaceState({}, "", "/");
    }
  })
  .catch((error) => {
    showError(error.message);
    loginButton.disabled = false;
    loginButton.querySelector(".button-label").textContent = "Choose an organisation";
  });

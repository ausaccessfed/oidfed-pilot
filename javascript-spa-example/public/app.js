const signInPanel = document.querySelector("#sign-in");
const landingPanel = document.querySelector(".hero");
const researcherDashboard = document.querySelector("#researcher-dashboard");
const loginButton = document.querySelector("#login-button");
const devLoginButton = document.querySelector("#dev-login-button");
const devLoginNote = document.querySelector("#dev-login-note");
const environmentLabel = document.querySelector("#environment-label");
const logoutButton = document.querySelector("#logout-button");
const errorMessage = document.querySelector("#error-message");
const providerDirectory = document.querySelector("#provider-directory");
const providerList = document.querySelector("#provider-list");
const directoryMessage = document.querySelector("#directory-message");
const directoryRetry = document.querySelector("#directory-retry");
const flowPanel = document.querySelector("#flow-panel");
const flowTitle = document.querySelector("#flow-title");
const flowCounter = document.querySelector("#flow-counter");
const selectedProviderLabel = document.querySelector("#selected-provider");
const flowProgress = document.querySelector("#flow-progress");
const flowError = document.querySelector("#flow-error");
const continueButton = document.querySelector("#continue-button");
const retryButton = document.querySelector("#retry-button");
const flowStepIds = ["start", "federation", "request", "provider", "response"];
let sessionAuthenticated = false;
let pollTimer;
let loginStarting = false;
let selectedProviderEntityId;

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function showProfile(profile) {
  sessionAuthenticated = true;
  landingPanel.hidden = true;
  researcherDashboard.hidden = false;
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

function renderProviders(providers) {
  providerDirectory.hidden = false;
  flowPanel.hidden = true;
  signInPanel.hidden = true;
  providerList.replaceChildren();
  directoryMessage.classList.remove("directory-error");
  providerList.setAttribute("aria-busy", "false");
  directoryRetry.hidden = providers.length > 0;

  if (providers.length === 0) {
    directoryMessage.textContent = "No OpenID Providers were found in this federation.";
    directoryMessage.hidden = false;
    directoryRetry.hidden = false;
    return;
  }

  directoryMessage.textContent = `${providers.length} identity provider${providers.length === 1 ? "" : "s"} available.`;
  directoryMessage.hidden = false;
  for (const provider of providers) {
    const item = document.createElement("div");
    item.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.className = "provider-card";
    button.type = "button";
    button.setAttribute("aria-label", `Select ${provider.displayName}, ${provider.domain}`);

    const monogram = document.createElement("span");
    monogram.className = "provider-monogram";
    monogram.setAttribute("aria-hidden", "true");
    monogram.textContent = provider.displayName.slice(0, 1).toUpperCase();

    const details = document.createElement("span");
    details.className = "provider-copy";
    const name = document.createElement("span");
    name.className = "provider-name";
    name.textContent = provider.displayName;
    const organization = document.createElement("span");
    organization.className = "provider-organization";
    organization.textContent = provider.organizationName;
    const domain = document.createElement("span");
    domain.className = "provider-domain";
    domain.textContent = provider.domain;
    details.append(name, organization, domain);

    const arrow = document.createElement("span");
    arrow.className = "provider-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    button.append(monogram, details, arrow);
    button.addEventListener("click", () => {
      for (const card of providerList.querySelectorAll(".provider-card")) card.disabled = true;
      beginLogin(provider.entityId);
    });
    item.append(button);
    providerList.append(item);
  }
}

function defaultFailureDetails(step) {
  const details = {
    federation: {
      whatWentWrong: "The provider’s federation information could not be verified.",
      expected: "A valid, unexpired chain of signed statements must connect the provider to the configured Trust Anchor.",
    },
    request: {
      whatWentWrong: "The RP could not prepare the signed OpenID request.",
      expected: "The request must use verified provider metadata and the RP’s active signing key.",
    },
    provider: {
      whatWentWrong: "The identity provider did not complete the authentication step.",
      expected: "The provider authenticates you and returns an authorization response to this RP.",
    },
    response: {
      whatWentWrong: "The callback could not be validated.",
      expected: "The returned state, code, PKCE verifier, and signed ID Token must match this sign-in transaction.",
    },
    start: {
      whatWentWrong: "The sign-in transaction could not be started.",
      expected: "The browser must have a valid session before a sign-in request begins.",
    },
  };
  return details[step] ?? details.start;
}

function renderFlow(flow) {
  const phase = flow?.phase ?? "idle";
  const activeSteps = {
    discovering: "federation",
    preparing_request: "request",
    ready: "provider",
    awaiting_callback: "provider",
    validating_response: "response",
  };
  const completeThrough = {
    discovering: 0,
    preparing_request: 1,
    ready: 2,
    awaiting_callback: 2,
    validating_response: 3,
    complete: 5,
  }[phase] ?? 0;
  const completedSteps = {
    discovering: 1,
    preparing_request: 2,
    ready: 3,
    awaiting_callback: 3,
    validating_response: 4,
    complete: 5,
  }[phase] ?? 0;
  const activeStep = activeSteps[phase];
  const failedIndex = phase === "error" ? flowStepIds.indexOf(flow.failureStep) : -1;
  const progress = phase === "error"
    ? Math.max(failedIndex, 0)
    : completedSteps;

  providerDirectory.hidden = true;
  flowPanel.hidden = phase === "idle" || phase === "listing_providers" || phase === "choose_provider";
  signInPanel.hidden = phase !== "idle" || sessionAuthenticated;
  flowError.hidden = phase !== "error";
  flowError.textContent = phase === "error"
    ? flow.error || "This step could not be completed. Try again."
    : "";
  continueButton.hidden = phase !== "ready";
  retryButton.hidden = phase !== "error";
  flowProgress.value = progress;

  if (flow.providerEntityId) {
    selectedProviderEntityId = flow.providerEntityId;
    selectedProviderLabel.textContent = flow.devMock
      ? "Selected: Demo identity provider"
      : `Selected: ${new URL(selectedProviderEntityId).hostname}`;
    selectedProviderLabel.hidden = false;
  } else {
    selectedProviderLabel.hidden = true;
  }

  if (phase === "complete") {
    flowTitle.textContent = flow.devMock ? "Demo sign-in complete" : "Sign-in complete";
    flowCounter.textContent = flow.devMock ? "DEMO COMPLETE" : "COMPLETE";
  } else if (phase === "error") {
    flowTitle.textContent = "Sign-in needs attention";
    flowCounter.textContent = "NEEDS ATTENTION";
  } else if (phase === "ready") {
    flowTitle.textContent = "Your secure request is ready";
    flowCounter.textContent = "STEP 4 OF 5";
  } else if (phase === "awaiting_callback") {
    flowTitle.textContent = flow.devMock
      ? "Simulating organisation sign-in…"
      : "Continue with your organisation";
    flowCounter.textContent = "STEP 4 OF 5";
  } else if (phase === "validating_response") {
    flowTitle.textContent = flow.devMock
      ? "Verifying the simulated response…"
      : "Verifying your sign-in…";
    flowCounter.textContent = "STEP 5 OF 5";
  } else if (phase === "preparing_request") {
    flowTitle.textContent = flow.devMock
      ? "Preparing a simulated sign-in request…"
      : "Preparing your secure request…";
    flowCounter.textContent = "STEP 3 OF 5";
  } else if (phase === "discovering") {
    flowTitle.textContent = flow.devMock
      ? "Checking simulated federation trust…"
      : "Checking federation trust…";
    flowCounter.textContent = "STEP 2 OF 5";
  }

  const fallbackDetails = defaultFailureDetails(flow.failureStep);
  const details = flow.details ?? fallbackDetails;
  for (const [index, id] of flowStepIds.entries()) {
    const item = flowPanel.querySelector(`[data-step="${id}"]`);
    const trigger = item.querySelector(".step-trigger");
    const status = item.querySelector(".step-status");
    const hint = item.querySelector(".step-hint");
    const detailPanel = item.querySelector(".step-details");
    const isFailed = index === failedIndex;
    const isComplete = phase === "complete" ||
      index <= completeThrough ||
      (phase === "error" && failedIndex > index);
    const isActive = id === activeStep;
    const needsUser = phase === "ready" && id === "provider";

    item.dataset.status = isFailed ? "error" : isComplete ? "complete" : isActive ? "active" : "waiting";
    trigger.disabled = !isFailed;
    trigger.setAttribute("aria-expanded", isFailed && trigger.getAttribute("aria-expanded") === "true" ? "true" : "false");
    hint.hidden = !isFailed;
    hint.textContent = trigger.getAttribute("aria-expanded") === "true" ? "Hide details" : "View details";
    detailPanel.hidden = !isFailed || trigger.getAttribute("aria-expanded") !== "true";
    detailPanel.querySelector('[data-detail="whatWentWrong"]').textContent = details.whatWentWrong;
    detailPanel.querySelector('[data-detail="expected"]').textContent = details.expected;

    status.textContent = isFailed
      ? "Needs attention"
      : isComplete
        ? "Complete"
        : needsUser
          ? "Ready when you are"
          : isActive
            ? phase === "awaiting_callback"
              ? "Waiting for your organisation"
              : "In progress"
            : "Waiting";
  }
}

async function requestProviders() {
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
    renderProviders(result.providers);
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
  if (flow.phase !== "idle" || !loginStarting) renderFlow(flow);
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
  renderFlow({ phase: "discovering", providerEntityId });
  pollTimer = window.setInterval(() => {
    refreshFlow().catch(() => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
      renderFlow({
        phase: "error",
        failureStep: "federation",
        error: "Sign-in progress could not be updated. Check your connection and try again.",
      });
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
        renderFlow({
          phase: "error",
          providerEntityId,
          failureStep: flow.phase === "discovering" ? "federation" : "request",
          error: "The server could not complete this step. Check the service status and try again.",
        });
      }
      return;
    }
    await refreshFlow();
  } catch (error) {
    renderFlow({
      phase: "error",
      providerEntityId,
      failureStep: "federation",
      error: error.message || "The sign-in flow could not start. Check your connection and try again.",
    });
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
  devLoginButton.hidden = !session.devMockAuthEnabled || session.authenticated;
  devLoginNote.hidden = !session.devMockAuthEnabled || session.authenticated;
  if (session.devMockAuthEnabled) {
    environmentLabel.textContent = "Development mode · mock sign-in";
    environmentLabel.classList.add("environment-demo");
  }
  if (session.authenticated) showProfile(session.profile);
  if (session.flow.phase === "choose_provider") {
    renderProviders(session.providers);
  } else if (session.flow.phase === "listing_providers") {
    await requestProviders();
  } else {
    renderFlow(session.flow);
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

devLoginButton.addEventListener("click", async () => {
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
    renderFlow(result.flow);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      const flowResponse = await fetch("/api/flow", { headers: { Accept: "application/json" } });
      if (!flowResponse.ok) throw new Error("The demo sign-in progress could not be loaded.");
      const flow = await flowResponse.json();
      renderFlow(flow);
      if (flow.phase === "complete") {
        await loadSession();
        return;
      }
      if (flow.phase === "error") throw new Error(flow.error || "The demo sign-in failed.");
    }
    throw new Error("The demo sign-in took too long to complete.");
  } catch (error) {
    renderFlow({
      phase: "error",
      devMock: true,
      failureStep: "start",
      error: error.message || "The demo sign-in could not be completed.",
    });
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
    renderFlow({ phase: "awaiting_callback", providerEntityId: selectedProviderEntityId });
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

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  logoutButton.setAttribute("aria-busy", "true");
  logoutButton.textContent = "Signing out…";
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
    logoutButton.disabled = false;
    logoutButton.removeAttribute("aria-busy");
    logoutButton.textContent = "Sign out";
  }
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

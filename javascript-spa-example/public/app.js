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
const metadataStatus = document.querySelector("#metadata-status");
const metadataContent = document.querySelector("#metadata-content");
const metadataRetry = document.querySelector("#metadata-retry");
const providerPolicyStatus = document.querySelector("#provider-policy-status");
const providerPolicyEmpty = document.querySelector("#provider-policy-empty");
const providerPolicyContent = document.querySelector("#provider-policy-content");
const providerPolicyRetry = document.querySelector("#provider-policy-retry");
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
let activeScreen = "main";

const metadataDescriptions = {
  iss: "Issuer of this signed Entity Configuration.",
  sub: "Entity Identifier described by this statement.",
  iat: "Unix time when this statement was issued.",
  exp: "Unix time when this statement expires.",
  jwks: "Public key set associated with this entity.",
  issuer: "Issuer identifier published in entity metadata.",
  authorization_endpoint: "URL where users begin the OpenID sign-in flow.",
  token_endpoint: "URL used to exchange an authorization code for tokens.",
  jwks_uri: "URL where the provider publishes its public signing keys.",
  id_token_signing_alg_values_supported: "Signing algorithms accepted for ID Tokens.",
  keys: "Public keys published by this entity.",
  kid: "Identifier for this public key.",
  kty: "Cryptographic key type.",
  crv: "Elliptic curve used by this key.",
  alg: "Algorithm associated with this key.",
  use: "Intended use of this key.",
  x: "Public X coordinate of this key.",
  y: "Public Y coordinate of this key.",
  authority_hints: "Federation intermediates that can lead to a Trust Anchor.",
  metadata: "Metadata describing the roles performed by this entity.",
  federation_entity: "OpenID Federation membership and organisation details.",
  openid_relying_party: "OpenID Connect relying-party metadata published to providers.",
  organization_name: "Name of the organisation operating this entity.",
  display_name: "Human-readable name for this entity.",
  client_name: "Name of this relying party shown by identity providers.",
  redirect_uris: "Callback addresses allowed for authorization responses.",
  response_types: "OpenID Connect response types supported by this relying party.",
  grant_types: "OAuth grant types supported by this relying party.",
  token_endpoint_auth_method: "Client authentication method used at the token endpoint.",
  token_endpoint_auth_signing_alg: "Algorithm used to sign client assertions.",
  client_registration_types: "Registration methods supported by this relying party.",
  scope: "Claims and access requested during sign-in.",
  openid_provider: "Metadata for OpenID Providers in the federation.",
  essential: "Require this metadata value to be present.",
  value: "Require this exact metadata value.",
  default: "Use this value when the provider does not publish one.",
  add: "Require these additional values.",
  one_of: "Require one of these values.",
  subset_of: "Require provider values to be within this allowed set.",
  superset_of: "Require provider values to include this required set.",
};

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

function describeMetadataField(key) {
  return metadataDescriptions[key] ?? "Published OpenID Federation metadata field.";
}

function appendMetadataField(parent, key, value) {
  const field = document.createElement("section");
  field.className = "metadata-field";

  const heading = document.createElement("div");
  heading.className = "metadata-field-heading";
  const fieldName = document.createElement("code");
  fieldName.textContent = key;
  const description = document.createElement("p");
  description.textContent = describeMetadataField(key);
  heading.append(fieldName, description);
  field.append(heading);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      const empty = document.createElement("code");
      empty.className = "metadata-value";
      empty.textContent = "[]";
      field.append(empty);
    } else if (value.every((entry) => entry === null || typeof entry !== "object")) {
      const list = document.createElement("ul");
      list.className = "metadata-values";
      for (const entry of value) {
        const item = document.createElement("li");
        const text = document.createElement("code");
        text.textContent = entry === null ? "null" : String(entry);
        item.append(text);
        list.append(item);
      }
      field.append(list);
    } else {
      const children = document.createElement("div");
      children.className = "metadata-children";
      for (const [index, entry] of value.entries()) {
        appendMetadataField(children, `[${index}]`, entry);
      }
      field.append(children);
    }
  } else if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      const empty = document.createElement("code");
      empty.className = "metadata-value";
      empty.textContent = "{}";
      field.append(empty);
    } else {
      const children = document.createElement("div");
      children.className = "metadata-children";
      for (const [childKey, childValue] of entries) {
        appendMetadataField(children, childKey, childValue);
      }
      field.append(children);
    }
  } else {
    const text = document.createElement("code");
    text.className = "metadata-value";
    text.textContent = value === null ? "null" : String(value);
    field.append(text);
  }

  parent.append(field);
}

async function loadServiceMetadata() {
  metadataStatus.classList.remove("metadata-error");
  metadataStatus.textContent = "Loading the signed Entity Configuration…";
  metadataStatus.hidden = false;
  metadataContent.hidden = true;
  metadataContent.setAttribute("aria-busy", "true");
  metadataContent.replaceChildren();
  metadataRetry.hidden = true;

  try {
    const response = await fetch("/api/service-metadata", {
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Service metadata could not be loaded.");
    if (!result.payload || typeof result.payload !== "object" || Array.isArray(result.payload)) {
      throw new Error("The Entity Configuration did not contain a metadata payload.");
    }
    for (const [key, value] of Object.entries(result.payload)) {
      appendMetadataField(metadataContent, key, value);
    }
    metadataContent.hidden = false;
    metadataStatus.textContent = `${Object.keys(result.payload).length} published Entity Configuration fields.`;
  } catch {
    metadataStatus.textContent = "Service metadata could not be loaded. Reload to try again.";
    metadataStatus.classList.add("metadata-error");
    metadataRetry.hidden = false;
  } finally {
    metadataContent.setAttribute("aria-busy", "false");
  }
}

async function loadProviderMetadataPolicy() {
  providerPolicyStatus.classList.remove("metadata-error");
  providerPolicyStatus.textContent = "Loading the configured provider metadata policy…";
  providerPolicyStatus.hidden = false;
  providerPolicyContent.hidden = true;
  providerPolicyContent.setAttribute("aria-busy", "true");
  providerPolicyContent.replaceChildren();
  providerPolicyEmpty.hidden = true;
  providerPolicyRetry.hidden = true;

  try {
    const response = await fetch("/api/provider-metadata-policy", {
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The provider policy could not be loaded.");
    if (!result.policy || typeof result.policy !== "object" || Array.isArray(result.policy)) {
      throw new Error("The configured provider policy is missing or invalid.");
    }

    const entries = Object.entries(result.policy);
    if (entries.length === 0) {
      providerPolicyStatus.hidden = true;
      providerPolicyEmpty.textContent =
        "No additional local rules configured. Policies from the validated federation chain still apply.";
      providerPolicyEmpty.hidden = false;
      return;
    }

    for (const [key, value] of entries) {
      appendMetadataField(providerPolicyContent, key, value);
    }
    providerPolicyStatus.textContent = `${entries.length} local entity-type policy groups.`;
    providerPolicyContent.hidden = false;
  } catch {
    providerPolicyStatus.textContent = "The provider metadata policy could not be loaded. Reload to try again.";
    providerPolicyStatus.classList.add("metadata-error");
    providerPolicyRetry.hidden = false;
  } finally {
    providerPolicyContent.setAttribute("aria-busy", "false");
  }
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

metadataRetry.addEventListener("click", loadServiceMetadata);
providerPolicyRetry.addEventListener("click", loadProviderMetadataPolicy);

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

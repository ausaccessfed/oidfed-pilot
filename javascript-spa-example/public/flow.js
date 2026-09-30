const signInPanel = document.querySelector("#sign-in");
const providerDirectory = document.querySelector("#provider-directory");
const flowPanel = document.querySelector("#flow-panel");
const flowTitle = document.querySelector("#flow-title");
const flowCounter = document.querySelector("#flow-counter");
const selectedProviderLabel = document.querySelector("#selected-provider");
const flowProgress = document.querySelector("#flow-progress");
const flowError = document.querySelector("#flow-error");
const continueButton = document.querySelector("#continue-button");
const retryButton = document.querySelector("#retry-button");
const flowStepIds = ["start", "federation", "request", "provider", "response"];
let selectedProviderEntityId;

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

export function renderFlow(flow, sessionAuthenticated) {
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
  const progress = phase === "error" ? Math.max(failedIndex, 0) : completedSteps;

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

  const details = flow.details ?? defaultFailureDetails(flow.failureStep);
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
    trigger.setAttribute(
      "aria-expanded",
      isFailed && trigger.getAttribute("aria-expanded") === "true" ? "true" : "false",
    );
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

export function getSelectedProviderEntityId() {
  return selectedProviderEntityId;
}

const signInPanel = document.querySelector("#sign-in");
const providerDirectory = document.querySelector("#provider-directory");
const providerList = document.querySelector("#provider-list");
const directoryMessage = document.querySelector("#directory-message");
const directoryRetry = document.querySelector("#directory-retry");
const flowPanel = document.querySelector("#flow-panel");

export function renderProviders(providers, onSelect) {
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
      onSelect(provider.entityId);
    });
    item.append(button);
    providerList.append(item);
  }
}

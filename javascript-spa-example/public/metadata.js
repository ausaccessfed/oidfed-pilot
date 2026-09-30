const metadataStatus = document.querySelector("#metadata-status");
const metadataContent = document.querySelector("#metadata-content");
const metadataRetry = document.querySelector("#metadata-retry");
const providerPolicyStatus = document.querySelector("#provider-policy-status");
const providerPolicyEmpty = document.querySelector("#provider-policy-empty");
const providerPolicyContent = document.querySelector("#provider-policy-content");
const providerPolicyRetry = document.querySelector("#provider-policy-retry");

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

function appendMetadataField(parent, key, value) {
  const field = document.createElement("section");
  field.className = "metadata-field";

  const heading = document.createElement("div");
  heading.className = "metadata-field-heading";
  const fieldName = document.createElement("code");
  fieldName.textContent = key;
  const description = document.createElement("p");
  description.textContent = metadataDescriptions[key] ?? "Published OpenID Federation metadata field.";
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

export async function loadServiceMetadata() {
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

export async function loadProviderMetadataPolicy() {
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

metadataRetry.addEventListener("click", loadServiceMetadata);
providerPolicyRetry.addEventListener("click", loadProviderMetadataPolicy);

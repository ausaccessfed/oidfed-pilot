# OpenID Federation sign-in

A small JavaScript single-page app with a Node.js backend. It authenticates users
through a user-selected OpenID Provider discovered from the Australian Access
Federation pilot. The selected provider's trust chain is validated to the
eduGAIN pilot Trust Anchor through the AAF intermediate authority.

The browser never handles signing keys or OAuth tokens. The backend serves the
RP's signed Entity Configuration, creates the signed authorization request,
exchanges the authorization code, and validates the ID Token.

## Requirements

- Node.js 22.12 or newer
- A public HTTPS origin for deployment. The OP must be able to fetch
  `/.well-known/openid-federation` from that origin.
- The configured origin must be registered/allowed by the federation operator.

## Configure and run

Install Caddy, trust its local certificate authority once, and start the app and
reverse proxy in separate terminals:

```sh
cd javascript-spa-example
cp .env.example .env
cp config.example.json config.json
npm install
caddy trust
npm start
```

In another terminal, from this example's directory, run Caddy:

```sh
caddy run --config Caddyfile
```

Open <https://sp.dev.localhost>. Caddy provisions local HTTPS and proxies to the Node
server on port 3000. Set `APP_ORIGIN` to the exact HTTPS origin (no trailing
slash); it is the RP Entity Identifier and determines the callback URL.
`npm start` loads `.env` when present. Values already set in the shell take
precedence.

### Metadata configuration

Customize `config.json` (starting from `config.example.json`) to set the
published `metadata.federation_entity` and
`metadata.openid_relying_party` fields. The environment variables
`ORGANIZATION_NAME`, `ENTITY_DISPLAY_NAME`, `OIDC_CLIENT_NAME`, and `OIDC_SCOPE`
override the corresponding file values. `PROVIDER_METADATA_POLICY` accepts a
JSON policy object and overrides the file policy. `OIDC_SCOPE` must contain
`openid`.
The app always generates its own signing JWKS and callback URI, and advertises
only the authorization-code and `private_key_jwt` flow it implements.

`providerMetadataPolicy` is an additional local policy applied to discovered
OpenID Provider metadata after the federation chain has been validated. It uses
the standard OpenID Federation policy operators and is shown in its own
**Provider policy** screen. It does not bypass or replace policies from the
validated federation chain. An RP leaf cannot publish the federation
`metadata_policy` claim; that claim is for federation authorities issuing
subordinate statements. The service's own public metadata appears in its signed
Entity Configuration. Configuration values under `metadata` are public; do not
put secrets there. Set `OIDFED_CONFIG_FILE` to select a different JSON file.

### Mock sign-in for UI development

To exercise the sign-in screens without contacting the federation or an identity
provider, start the app with both development settings enabled:

```sh
NODE_ENV=development DEV_MOCK_AUTH=true \
  APP_ORIGIN=https://sp.dev.localhost PORT=3000 npm start
```

The sign-in card then offers **Run development sign-in**. It simulates the
federation, request, provider, and response stages and signs in a demo profile
(`demo.researcher@example.test`). The header labels mock mode, and the server
prints a warning. This is not a real authentication flow: the simulated profile
and responses must never be used to authorize access, and the mock endpoint is
not registered unless `NODE_ENV=development` and `DEV_MOCK_AUTH=true`.

On sign-in, the app displays the providers from the federation directory as
selectable cards. It uses `https://ta.dev.aaf.edu.au/list` with the
`openid_provider` entity-type filter. If a Federation Entity Collection endpoint
is available, set `ENTITY_COLLECTION_ENDPOINT` to use that endpoint instead.
Provider display names come from public metadata and are not treated as trusted
until the selected provider's chain is validated.

Use **Service metadata** in the top navigation to inspect every public claim in
this RP's current signed Entity Configuration, with concise field descriptions.
Use **Provider policy** to review local rules applied to discovered provider
metadata. The metadata screen reads the generated statement served at
`/.well-known/openid-federation`; it is not an editable configuration view.
The landing page links directly to the OpenID Federation Explorer views for the
eduGAIN pilot Trust Anchor and AAF intermediate used by this example.

Local HTTPS supports browser development, but the remote AAF OP cannot reach
`.localhost` to fetch the RP's Federation Entity Configuration. In addition,
the current eduGAIN root Entity Configuration publishes the same JWK `kid`
twice. `@oidfed/core` rejects duplicate key identifiers during chain validation;
the app does not bypass this check. Complete sign-in requires a publicly
reachable HTTPS RP origin and a corrected root JWKS.

## Deploy

The GitHub Actions workflow publishes the container image to
`ghcr.io/ausaccessfed/javascript-spa-example` when changes to this example are
pushed to `main`. It also builds (without publishing) pull requests.

Build and run the image locally from the repository root:

```sh
make build-image-javascript-spa-example
make run-image-javascript-spa-example
```

The image includes `config.example.json` as its default `/app/config.json`.
The run target enables the development mock sign-in with
`NODE_ENV=development` and `DEV_MOCK_AUTH=true`, as described above. Set
`APP_ORIGIN` to use a different HTTPS origin, for example
`APP_ORIGIN=https://your-public-origin.example make run-image-javascript-spa-example`. Mount a
customized `config.json` at `/app/config.json` to use deployment-specific
metadata. Mock sign-in is for local development only; do not use this run
target for deployment. It persists keys in `javascript-spa-example/.keys`.

For deployment, replace the local Caddy site address in this directory's
`Caddyfile` with the public hostname and set `APP_ORIGIN` to that same origin. Keep
the `.keys` directory on persistent, private storage: it contains the federation
and OIDC signing keys that identify this RP. Back it up securely and do not
share it between unrelated deployments. The in-memory login sessions are lost
when the process restarts, so run a single instance or replace the session map
with a shared server-side store before scaling horizontally.

The supplied `https://ta.dev.aaf.edu.au` entity is an AAF intermediate: its
Entity Configuration points to `https://ta.oidf-pilot.edugain.org`, the actual
root Trust Anchor. The app pins the root's public key in `server.js` and uses
the AAF intermediate as its own authority hint. The key is public material, not
a secret; confirm key changes with the federation operator and update the pin
before a Trust Anchor key rotation. Do not replace the pin with a key blindly
fetched during login: that would remove the trust bootstrap.

## Flow and protections

The SPA walks through five stages: choose a provider; validate its signed
federation chain and resolved metadata; create a signed Request Object with
one-time `state`, `nonce`, and PKCE values; authenticate at the provider; and
validate the callback and ID Token. Each stage is visible in the interface.
If a stage fails, activate its highlighted step to see what went wrong and what
the protocol expected. After authentication, the SPA shows a researcher
workspace with the returned identity details. Its service and activity cards
are illustrative only; the example does not fetch research-service data. Only
selected profile claims are held in the server-side session; OAuth tokens are
not exposed to the browser.

The app uses in-memory sessions and is an integration starter, not a complete
production deployment. Add operational controls such as rate limiting,
monitoring, key rotation, and a durable shared session store as appropriate.

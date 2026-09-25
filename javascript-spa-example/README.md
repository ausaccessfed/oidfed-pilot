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
npm install
caddy trust
APP_ORIGIN=https://sp.dev.localhost PORT=3000 npm start
```

In another terminal, from this example's directory, run Caddy:

```sh
caddy run --config Caddyfile
```

Open <https://sp.dev.localhost>. Caddy provisions local HTTPS and proxies to the Node
server on port 3000. Set `APP_ORIGIN` to the exact HTTPS origin (no trailing
slash); it is the RP Entity Identifier and determines the callback URL.

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

Local HTTPS supports browser development, but the remote AAF OP cannot reach
`.localhost` to fetch the RP's Federation Entity Configuration. In addition,
the current eduGAIN root Entity Configuration publishes the same JWK `kid`
twice. `@oidfed/core` rejects duplicate key identifiers during chain validation;
the app does not bypass this check. Complete sign-in requires a publicly
reachable HTTPS RP origin and a corrected root JWKS.

## Deploy

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

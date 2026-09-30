# Setup

## Local development

1. Install Node.js 22.12 or newer and Caddy.
2. Configure the app:

   ```sh
   cd javascript-spa-example
   cp .env.dist .env
   ```

   Set `APP_ORIGIN` to the app's HTTPS origin. To enable the local demo sign-in,
   set `NODE_ENV=development` and `DEV_MOCK_AUTH=true` in `.env`.
3. Install dependencies and trust Caddy's local certificate:

   ```sh
   npm install
   caddy trust
   ```

4. Start the app:

   ```sh
   npm start
   ```

5. In a second terminal, start Caddy:

   ```sh
   caddy run --config Caddyfile
   ```

6. Open <https://sp.dev.localhost>. Local demo sign-in does not contact the
   federation. For real federation sign-in, use a publicly reachable HTTPS
   origin approved by the federation operator.

## Run with Docker

1. Install Docker and create `javascript-spa-example/.env` as described above.
2. From the repository root, build and run the image:

   ```sh
   make build-image-javascript-spa-example
   make run-image-javascript-spa-example
   ```

3. To use the local HTTPS address, trust Caddy's certificate with `caddy trust`
   and run `caddy run --config javascript-spa-example/Caddyfile` in another
   terminal.
4. Open <https://sp.dev.localhost>.

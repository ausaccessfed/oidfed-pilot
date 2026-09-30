build-image-javascript-spa-example:
	docker build -t javascript-spa-example ./javascript-spa-example

run-image-javascript-spa-example:
	docker run --rm -p 3000:3000 \
		--env-file "javascript-spa-example/.env" \
		-e NODE_ENV=development \
		-e DEV_MOCK_AUTH=true \
		-v "$(CURDIR)/javascript-spa-example/.keys:/app/.keys" \
		javascript-spa-example

prepare-image-javascript-oauth-s2s-example:
	@test -f javascript-oauth-s2s-example/.env || cp javascript-oauth-s2s-example/.env.dist javascript-oauth-s2s-example/.env

build-image-javascript-oauth-s2s-example: prepare-image-javascript-oauth-s2s-example
	docker compose -f javascript-oauth-s2s-example/docker-compose.yml build

setup-image-javascript-oauth-s2s-example: build-image-javascript-oauth-s2s-example
	docker compose -f javascript-oauth-s2s-example/docker-compose.yml run --rm --no-deps s2s-demo npm run setup

run-image-javascript-oauth-s2s-example: build-image-javascript-oauth-s2s-example
	docker compose -f javascript-oauth-s2s-example/docker-compose.yml up

stop-image-javascript-oauth-s2s-example: prepare-image-javascript-oauth-s2s-example
	docker compose -f javascript-oauth-s2s-example/docker-compose.yml down

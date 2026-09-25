APP_ORIGIN ?= https://sp.dev.localhost

.PHONY: build-image-javascript-spa-example run-image-javascript-spa-example

build-image-javascript-spa-example:
	docker build -t javascript-spa-example ./javascript-spa-example

run-image-javascript-spa-example:
	docker run --rm -p 3000:3000 \
		-e NODE_ENV=development \
		-e DEV_MOCK_AUTH=true \
		-e APP_ORIGIN="$(APP_ORIGIN)" \
		-v "$(CURDIR)/javascript-spa-example/.keys:/app/.keys" \
		javascript-spa-example

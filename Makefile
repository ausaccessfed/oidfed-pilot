build-image-javascript-spa-example:
	docker build -t javascript-spa-example ./javascript-spa-example

run-image-javascript-spa-example:
	docker run --rm -p 3000:3000 \
		--env-file "javascript-spa-example/.env" \
		-e NODE_ENV=development \
		-e DEV_MOCK_AUTH=true \
		-v "$(CURDIR)/javascript-spa-example/.keys:/app/.keys" \
		javascript-spa-example

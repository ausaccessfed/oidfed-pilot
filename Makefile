PROJECTS := $(patsubst %/Dockerfile,%,$(wildcard */Dockerfile))
APP_ORIGIN ?= https://sp.dev.localhost

.PHONY: build-image run-image

build-image run-image:
	@bash -e -c 'PS3="Select project: "; select project in $(PROJECTS); do \
		[ -n "$$project" ] || continue; \
		if [ "$@" = build-image ]; then \
			docker build -t "$$project" "./$$project"; \
		else \
			docker run --rm -p 3000:3000 \
				-e NODE_ENV=development \
				-e DEV_MOCK_AUTH=true \
				-e APP_ORIGIN="$(APP_ORIGIN)" \
				-v "$(CURDIR)/$$project/.keys:/app/.keys" \
				"$$project"; \
		fi; \
		break; \
	done'

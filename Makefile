PROJECT ?=
APP_ORIGIN ?= https://sp.dev.localhost

.PHONY: build-image run-image
export PROJECT

build-image run-image:
	@set -eu; \
	projects=$$(find . -mindepth 2 -maxdepth 2 -type f -name Dockerfile | sed 's#^\./##; s#/Dockerfile$$##' | sort); \
	if [ -z "$$projects" ]; then echo "No top-level project folders with a Dockerfile were found." >&2; exit 1; fi; \
	project="$${PROJECT:-}"; \
	if [ -n "$$project" ]; then \
		requested="$$project"; \
		project=$$(printf '%s\n' "$$projects" | awk -v name="$$requested" '$$0 == name { print; exit }'); \
		if [ -z "$$project" ]; then echo "No Dockerfile found for project folder '$$requested'." >&2; exit 1; fi; \
	else \
		echo "Available project folders:"; \
		printf '%s\n' "$$projects" | awk '{ printf "  %d) %s\n", NR, $$0 }'; \
		count=$$(printf '%s\n' "$$projects" | awk 'END { print NR }'); \
		printf 'Select a project [1-%s]: ' "$$count"; \
		IFS= read -r choice; \
		case "$$choice" in ''|*[!0-9]*) echo "Enter one of the listed numbers." >&2; exit 1 ;; esac; \
		project=$$(printf '%s\n' "$$projects" | awk -v choice="$$choice" 'NR == choice { print; exit }'); \
		if [ -z "$$project" ]; then echo "Selection is outside the listed options." >&2; exit 1; fi; \
	fi; \
	if [ "$@" = "build-image" ]; then \
		docker build -t "$$project" "./$$project"; \
	else \
		docker run --rm -p 3000:3000 \
			-e NODE_ENV=development \
			-e DEV_MOCK_AUTH=true \
			-e APP_ORIGIN="$(APP_ORIGIN)" \
			-v "$(CURDIR)/$$project/.keys:/app/.keys" \
			"$$project"; \
	fi

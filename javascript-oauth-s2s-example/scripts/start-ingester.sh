#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ -f .env ]; then
	exec node --env-file=.env src/ingester.js
fi
exec node src/ingester.js

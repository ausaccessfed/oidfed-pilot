#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ -f .env ]; then
	exec node --env-file=.env src/sender.js
fi
exec node src/sender.js

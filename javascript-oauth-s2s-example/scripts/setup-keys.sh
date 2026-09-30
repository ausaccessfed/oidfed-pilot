#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
if [ -f .env ]; then
	exec node --env-file=.env scripts/setup.js
fi
exec node scripts/setup.js

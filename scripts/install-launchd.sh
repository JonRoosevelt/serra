#!/usr/bin/env bash
# Prepare a profile's launchd release. Activation is a separate, explicit command.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/src/manage.ts" prepare "$@"

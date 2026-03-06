#!/usr/bin/env bash
set -euo pipefail

OPENCLAW="${OPENCLAW_BIN:-/home/scott/.npm-global/bin/openclaw}"

# Keep tools minimal and allow only Memory-Munch plugin tools.
"$OPENCLAW" config set tools.profile minimal >/dev/null
"$OPENCLAW" config set --strict-json tools.alsoAllow '["memory-munch-tools"]' >/dev/null

# Disable memory-flush hook behavior.
"$OPENCLAW" hooks disable session-memory >/dev/null || true

# Restart gateway to apply changes.
"$OPENCLAW" gateway restart >/dev/null

echo "ok"
echo "tools.profile=$("$OPENCLAW" config get tools.profile)"
echo "tools.alsoAllow=$("$OPENCLAW" config get tools.alsoAllow --json)"

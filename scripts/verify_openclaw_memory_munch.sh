#!/usr/bin/env bash
set -euo pipefail

QUERY="${1:-temporary searchable inbox before CRM sync}"
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"

if [[ -z "${OPENCLAW_BIN}" ]]; then
  echo "openclaw CLI not found in PATH." >&2
  exit 1
fi

echo "== Plugin info =="
"${OPENCLAW_BIN}" plugins info memory-munch-tools --json

echo
echo "== Native memory status =="
"${OPENCLAW_BIN}" memory status --json

echo
echo "== Agent query =="
"${OPENCLAW_BIN}" agent --agent main --message "${QUERY}" --json

#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
MODE="${1:-}"

usage() {
  cat <<'USAGE'
Usage:
  set_memory_munch_runtime_mode.sh <mode>

Modes:
  defaults      autoIndexWatch=true, autoInjectPromptContext=false, exposeRawTools=false
  manual-index  autoIndexWatch=false, autoInjectPromptContext=false, exposeRawTools=false

Examples:
  bash ./scripts/set_memory_munch_runtime_mode.sh defaults
  bash ./scripts/set_memory_munch_runtime_mode.sh manual-index
USAGE
}

if [[ -z "${OPENCLAW_BIN}" ]]; then
  echo "openclaw CLI not found in PATH." >&2
  exit 1
fi

case "${MODE}" in
  defaults)
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.autoIndexWatch true
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.autoInjectPromptContext false
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.exposeRawTools false
    "${OPENCLAW_BIN}" daemon restart
    echo "Applied runtime mode: defaults"
    ;;
  manual-index)
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.autoInjectPromptContext false
    "${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.exposeRawTools false
    "${OPENCLAW_BIN}" daemon restart
    echo "Applied runtime mode: manual-index"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    usage >&2
    exit 2
    ;;
esac

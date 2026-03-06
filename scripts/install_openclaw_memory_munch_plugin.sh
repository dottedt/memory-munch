#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_DIR="${HOME}/.openclaw"
WORKSPACE_DIR=""
CONFIG_PATH=""
PYTHON_BIN=""
TIMEOUT_MS="15000"
NO_RESTART="0"

usage() {
  cat <<'USAGE'
Usage:
  install_openclaw_memory_munch_plugin.sh [options]

Options:
  --state-dir <dir>      OpenClaw state dir (default: ~/.openclaw)
  --workspace <dir>      OpenClaw workspace dir (default: <state-dir>/workspace)
  --config <path>        dmemorymunch config path (default: <workspace>/dmemorymunch-mpc.toml)
  --python <path>        Python executable for bridge (default: repo .venv/bin/python or python3)
  --timeout-ms <num>     Bridge timeout in ms (default: 15000)
  --no-restart           Do not restart OpenClaw daemon after install
  -h, --help             Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state-dir)
      STATE_DIR="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE_DIR="$2"
      shift 2
      ;;
    --config)
      CONFIG_PATH="$2"
      shift 2
      ;;
    --python)
      PYTHON_BIN="$2"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --no-restart)
      NO_RESTART="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "${WORKSPACE_DIR}" ]]; then
  WORKSPACE_DIR="${STATE_DIR}/workspace"
fi

if [[ -z "${CONFIG_PATH}" ]]; then
  CONFIG_PATH="${WORKSPACE_DIR}/dmemorymunch-mpc.toml"
fi

if [[ -z "${PYTHON_BIN}" ]]; then
  if [[ -x "${REPO_ROOT}/.venv/bin/python" ]]; then
    PYTHON_BIN="${REPO_ROOT}/.venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3)"
  fi
fi

if [[ ! -x "${PYTHON_BIN}" ]]; then
  echo "Python not executable: ${PYTHON_BIN}" >&2
  exit 1
fi

BRIDGE_SCRIPT="${REPO_ROOT}/scripts/openclaw_memory_munch_bridge.py"
PLUGIN_SRC="${REPO_ROOT}/extensions/memory-munch-tools"
PLUGIN_DST="${STATE_DIR}/extensions/memory-munch-tools"
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"

if [[ -z "${OPENCLAW_BIN}" ]]; then
  echo "openclaw CLI not found in PATH." >&2
  exit 1
fi

if [[ ! -f "${BRIDGE_SCRIPT}" ]]; then
  echo "Bridge script not found: ${BRIDGE_SCRIPT}" >&2
  exit 1
fi

if [[ ! -d "${PLUGIN_SRC}" ]]; then
  echo "Plugin source dir not found: ${PLUGIN_SRC}" >&2
  exit 1
fi

mkdir -p "${WORKSPACE_DIR}" "${PLUGIN_DST}"
cp -f "${PLUGIN_SRC}/index.ts" "${PLUGIN_DST}/index.ts"
cp -f "${PLUGIN_SRC}/openclaw.plugin.json" "${PLUGIN_DST}/openclaw.plugin.json"

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp -f "${REPO_ROOT}/dmemorymunch-mpc.toml" "${CONFIG_PATH}"
fi

CFG_JSON="$("${PYTHON_BIN}" - <<PY
import json
print(json.dumps({
  "pythonBin": "${PYTHON_BIN}",
  "bridgeScript": "${BRIDGE_SCRIPT}",
  "configPath": "${CONFIG_PATH}",
  "timeoutMs": int("${TIMEOUT_MS}")
}))
PY
)"

"${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.enabled true
"${OPENCLAW_BIN}" config set --strict-json plugins.entries.memory-munch-tools.config "${CFG_JSON}"
"${OPENCLAW_BIN}" config set plugins.slots.memory memory-munch-tools

if [[ "${NO_RESTART}" != "1" ]]; then
  "${OPENCLAW_BIN}" daemon restart
fi

echo "Installed memory-munch-tools to: ${PLUGIN_DST}"
echo "Configured plugin bridge config in OpenClaw."
echo "Workspace: ${WORKSPACE_DIR}"
echo "Memory-Munch config: ${CONFIG_PATH}"
echo "Python: ${PYTHON_BIN}"
echo "Bridge: ${BRIDGE_SCRIPT}"

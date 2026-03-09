#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_DIR="${HOME}/.openclaw"
WORKSPACE_DIR=""
CONFIG_PATH=""
TIMEOUT_MS="15000"
NO_RESTART="0"
ALLOWLIST_MODE="prompt"
BACKUP_ROOT=""
AUTO_INJECT_PROMPT="false"
EXPOSE_RAW_TOOLS="false"
AUTO_INDEX_WATCH="true"
AUTO_INDEX_WATCH_INTERVAL_SEC="1.5"

usage() {
  cat <<'USAGE'
Usage:
  install_openclaw_memory_munch_plugin.sh [options]

Options:
  --state-dir <dir>      OpenClaw state dir (default: ~/.openclaw)
  --workspace <dir>      OpenClaw workspace dir (default: <state-dir>/workspace)
  --config <path>        dmemorymunch config path (default: <workspace>/dmemorymunch-mpc.toml)
  --timeout-ms <num>     Tool timeout budget in ms (default: 15000)
  --allowlist-mode <m>   plugins.allow behavior: prompt|enable|skip (default: prompt)
  --auto-inject-prompt   Auto-inject snippets into prompts: true|false (default: false)
  --expose-raw-tools     Expose low-level memory_munch_* tools: true|false (default: false)
  --auto-index-watch     Run plugin-managed background index watcher: true|false (default: true)
  --watch-interval-sec   Polling interval for watcher (default: 1.5, min: 0.5)
  --backup-root <dir>    Backup root (default: <state-dir>/backups/memory-munch-tools)
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
    --timeout-ms)
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --allowlist-mode)
      ALLOWLIST_MODE="$2"
      shift 2
      ;;
    --auto-inject-prompt)
      AUTO_INJECT_PROMPT="$2"
      shift 2
      ;;
    --expose-raw-tools)
      EXPOSE_RAW_TOOLS="$2"
      shift 2
      ;;
    --auto-index-watch)
      AUTO_INDEX_WATCH="$2"
      shift 2
      ;;
    --watch-interval-sec)
      AUTO_INDEX_WATCH_INTERVAL_SEC="$2"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="$2"
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

case "${ALLOWLIST_MODE}" in
  prompt|enable|skip) ;;
  *)
    echo "Invalid --allowlist-mode: ${ALLOWLIST_MODE} (use prompt|enable|skip)" >&2
    exit 2
    ;;
esac

case "${AUTO_INJECT_PROMPT}" in
  true|false) ;;
  *)
    echo "Invalid --auto-inject-prompt: ${AUTO_INJECT_PROMPT} (use true|false)" >&2
    exit 2
    ;;
esac

case "${EXPOSE_RAW_TOOLS}" in
  true|false) ;;
  *)
    echo "Invalid --expose-raw-tools: ${EXPOSE_RAW_TOOLS} (use true|false)" >&2
    exit 2
    ;;
esac

case "${AUTO_INDEX_WATCH}" in
  true|false) ;;
  *)
    echo "Invalid --auto-index-watch: ${AUTO_INDEX_WATCH} (use true|false)" >&2
    exit 2
    ;;
esac

if ! awk "BEGIN{v=${AUTO_INDEX_WATCH_INTERVAL_SEC}; exit !(v>=0.5)}"; then
  echo "Invalid --watch-interval-sec: ${AUTO_INDEX_WATCH_INTERVAL_SEC} (min 0.5)" >&2
  exit 2
fi

if [[ -z "${WORKSPACE_DIR}" ]]; then
  WORKSPACE_DIR="${STATE_DIR}/workspace"
fi

if [[ -z "${BACKUP_ROOT}" ]]; then
  BACKUP_ROOT="${STATE_DIR}/backups/memory-munch-tools"
fi

if [[ -z "${CONFIG_PATH}" ]]; then
  CONFIG_PATH="${WORKSPACE_DIR}/dmemorymunch-mpc.toml"
fi

PLUGIN_SRC="${REPO_ROOT}/extensions/memory-munch-tools"
PLUGIN_DST="${STATE_DIR}/extensions/memory-munch-tools"
OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
OPENCLAW_CONFIG_PATH="${STATE_DIR}/openclaw.json"

if [[ -z "${OPENCLAW_BIN}" ]]; then
  echo "openclaw CLI not found in PATH." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node runtime not found in PATH." >&2
  exit 1
fi

if [[ ! -d "${PLUGIN_SRC}" ]]; then
  echo "Plugin source dir not found: ${PLUGIN_SRC}" >&2
  exit 1
fi

oc_set() {
  local path="$1"
  local value="$2"
  "${OPENCLAW_BIN}" config set "${path}" "${value}" >/dev/null
}

oc_set_json() {
  local path="$1"
  local value="$2"
  "${OPENCLAW_BIN}" config set --strict-json "${path}" "${value}" >/dev/null
}

oc_get_json_or_missing() {
  local path="$1"
  local raw
  if ! raw="$("${OPENCLAW_BIN}" config get "${path}" --json 2>/dev/null)"; then
    echo "__MM_MISSING__"
    return 0
  fi
  node -e '
const raw=(process.argv[1]||"").trim();
const candidates=[raw, ...raw.split(/\n/).map(s=>s.trim()).filter(Boolean).reverse()];
for (const cand of candidates){
  try { console.log(JSON.stringify(JSON.parse(cand))); process.exit(0); } catch {}
}
console.log("__MM_MISSING__");
' "${raw}"
}

BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_ID}"
mkdir -p "${BACKUP_DIR}"

PREV_PLUGIN_DIR_EXISTS=0
PREV_INDEX_EXISTS=0
PREV_MANIFEST_EXISTS=0
PREV_OPENCLAW_CONFIG_EXISTS=0
CREATED_CONFIG_PATH=0
PREV_PLUGIN_DIR_SNAPSHOT=0

if [[ -d "${PLUGIN_DST}" ]]; then
  PREV_PLUGIN_DIR_EXISTS=1
  PREV_PLUGIN_DIR_SNAPSHOT=1
  cp -a "${PLUGIN_DST}" "${BACKUP_DIR}/plugin_dir"
fi
if [[ -f "${PLUGIN_DST}/index.ts" ]]; then
  PREV_INDEX_EXISTS=1
  cp -p "${PLUGIN_DST}/index.ts" "${BACKUP_DIR}/index.ts"
fi
if [[ -f "${PLUGIN_DST}/openclaw.plugin.json" ]]; then
  PREV_MANIFEST_EXISTS=1
  cp -p "${PLUGIN_DST}/openclaw.plugin.json" "${BACKUP_DIR}/openclaw.plugin.json"
fi
if [[ -f "${OPENCLAW_CONFIG_PATH}" ]]; then
  PREV_OPENCLAW_CONFIG_EXISTS=1
  cp -p "${OPENCLAW_CONFIG_PATH}" "${BACKUP_DIR}/openclaw.json"
fi

echo "$(oc_get_json_or_missing plugins.entries.memory-munch-tools.enabled)" > "${BACKUP_DIR}/prior_enabled.json"
echo "$(oc_get_json_or_missing plugins.entries.memory-munch-tools.config)" > "${BACKUP_DIR}/prior_plugin_config.json"
echo "$(oc_get_json_or_missing plugins.slots.memory)" > "${BACKUP_DIR}/prior_memory_slot.json"
echo "$(oc_get_json_or_missing plugins.allow)" > "${BACKUP_DIR}/prior_plugins_allow.json"
echo "0" > "${BACKUP_DIR}/allowlist_touched"

mkdir -p "${WORKSPACE_DIR}" "${PLUGIN_DST}"
rm -rf "${PLUGIN_DST}"
mkdir -p "${PLUGIN_DST}"
cp -a "${PLUGIN_SRC}/." "${PLUGIN_DST}/"

if [[ "${PREV_PLUGIN_DIR_SNAPSHOT}" == "1" && -d "${BACKUP_DIR}/plugin_dir" ]]; then
  diff -ruN "${BACKUP_DIR}/plugin_dir" "${PLUGIN_DST}" > "${BACKUP_DIR}/plugin_dir.diff" || true
else
  (
    cd "${PLUGIN_DST}"
    find . -type f | sort | sed 's#^\./#ADDED: #' > "${BACKUP_DIR}/plugin_dir.diff"
  )
fi

if [[ ! -f "${CONFIG_PATH}" ]]; then
  cp -f "${REPO_ROOT}/dmemorymunch-mpc.toml" "${CONFIG_PATH}"
  CREATED_CONFIG_PATH=1
fi

cat > "${BACKUP_DIR}/manifest.env" <<EOF
STATE_DIR=${STATE_DIR}
WORKSPACE_DIR=${WORKSPACE_DIR}
PLUGIN_DST=${PLUGIN_DST}
CONFIG_PATH=${CONFIG_PATH}
OPENCLAW_CONFIG_PATH=${OPENCLAW_CONFIG_PATH}
PREV_PLUGIN_DIR_EXISTS=${PREV_PLUGIN_DIR_EXISTS}
PREV_PLUGIN_DIR_SNAPSHOT=${PREV_PLUGIN_DIR_SNAPSHOT}
PREV_INDEX_EXISTS=${PREV_INDEX_EXISTS}
PREV_MANIFEST_EXISTS=${PREV_MANIFEST_EXISTS}
PREV_OPENCLAW_CONFIG_EXISTS=${PREV_OPENCLAW_CONFIG_EXISTS}
CREATED_CONFIG_PATH=${CREATED_CONFIG_PATH}
EOF

CFG_JSON="$(cat <<JSON
{
  "configPath": "${CONFIG_PATH}",
  "timeoutMs": ${TIMEOUT_MS},
  "autoInjectPromptContext": ${AUTO_INJECT_PROMPT},
  "exposeRawTools": ${EXPOSE_RAW_TOOLS},
  "autoIndexWatch": ${AUTO_INDEX_WATCH},
  "autoIndexWatchIntervalSec": ${AUTO_INDEX_WATCH_INTERVAL_SEC}
}
JSON
)"

oc_set plugins.entries.memory-munch-tools.enabled true
echo "Configured plugins.entries.memory-munch-tools.enabled=true"
oc_set_json plugins.entries.memory-munch-tools.config "${CFG_JSON}"
echo "Configured plugins.entries.memory-munch-tools.config"
oc_set plugins.slots.memory memory-munch-tools
echo "Configured plugins.slots.memory=memory-munch-tools"

warn_allowlist() {
  cat >&2 <<'WARN'
Warning: OpenClaw plugin trust policy
- plugins.allow controls which plugins are explicitly trusted.
- Adding "memory-munch-tools" reduces startup trust warnings and pins this plugin as approved.
- This does not grant extra OS permissions by itself; plugin code still runs in-process.
WARN
}

enable_allowlist_entry() {
  local current merged
  current="$(oc_get_json_or_missing plugins.allow)"
  if [[ "${current}" == "__MM_MISSING__" ]]; then
    current="[]"
  fi
  merged="$(node -e '
const raw=(process.argv[1]||"[]").trim()||"[]";
let arr=[]; try{ arr=JSON.parse(raw); }catch{}
if(!Array.isArray(arr)) arr=[];
const out=[];
for(const item of arr){ if(typeof item==="string" && !out.includes(item)) out.push(item); }
if(!out.includes("memory-munch-tools")) out.push("memory-munch-tools");
console.log(JSON.stringify(out));
' "${current}")"
  oc_set_json plugins.allow "${merged}"
  echo "1" > "${BACKUP_DIR}/allowlist_touched"
  echo "Added memory-munch-tools to plugins.allow"
}

case "${ALLOWLIST_MODE}" in
  enable)
    warn_allowlist
    enable_allowlist_entry
    ;;
  skip)
    warn_allowlist
    echo "Skipped plugins.allow change (--allowlist-mode=skip)"
    ;;
  prompt)
    warn_allowlist
    if [[ -t 0 ]]; then
      read -r -p "Add memory-munch-tools to plugins.allow now? [y/N] " REPLY
      case "${REPLY}" in
        y|Y|yes|YES)
          enable_allowlist_entry
          ;;
        *)
          echo "Skipped plugins.allow change"
          ;;
      esac
    else
      echo "Non-interactive shell: skipped plugins.allow change (use --allowlist-mode=enable to force)"
    fi
    ;;
esac

if [[ "${NO_RESTART}" != "1" ]]; then
  "${OPENCLAW_BIN}" daemon restart >/dev/null
  echo "Restarted OpenClaw daemon"
fi

echo "Installed memory-munch-tools to: ${PLUGIN_DST}"
echo "Configured plugin config in OpenClaw."
echo "Workspace: ${WORKSPACE_DIR}"
echo "Memory-Munch config: ${CONFIG_PATH}"
echo "Backup snapshot: ${BACKUP_DIR}"
echo "Plugin file diff report: ${BACKUP_DIR}/plugin_dir.diff"

#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${HOME}/.openclaw"
BACKUP_ROOT=""
BACKUP_DIR=""
NO_RESTART="0"

usage() {
  cat <<'USAGE'
Usage:
  undo_openclaw_memory_munch_install.sh [options]

Options:
  --state-dir <dir>      OpenClaw state dir (default: ~/.openclaw)
  --backup-root <dir>    Backup root (default: <state-dir>/backups/memory-munch-tools)
  --backup-dir <dir>     Specific backup directory to restore
  --no-restart           Do not restart OpenClaw daemon after restore
  -h, --help             Show this help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --state-dir)
      STATE_DIR="$2"
      shift 2
      ;;
    --backup-root)
      BACKUP_ROOT="$2"
      shift 2
      ;;
    --backup-dir)
      BACKUP_DIR="$2"
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

if [[ -z "${BACKUP_ROOT}" ]]; then
  BACKUP_ROOT="${STATE_DIR}/backups/memory-munch-tools"
fi

if [[ -z "${BACKUP_DIR}" ]]; then
  if [[ ! -d "${BACKUP_ROOT}" ]]; then
    echo "Backup root not found: ${BACKUP_ROOT}" >&2
    exit 1
  fi
  BACKUP_DIR="$(ls -1dt "${BACKUP_ROOT}"/* 2>/dev/null | head -n 1 || true)"
fi

if [[ -z "${BACKUP_DIR}" || ! -d "${BACKUP_DIR}" ]]; then
  echo "Backup dir not found." >&2
  exit 1
fi

MANIFEST="${BACKUP_DIR}/manifest.env"
if [[ ! -f "${MANIFEST}" ]]; then
  echo "Missing manifest: ${MANIFEST}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${MANIFEST}"
set +a

OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"

mkdir -p "${PLUGIN_DST}"

if [[ "${PREV_PLUGIN_DIR_SNAPSHOT:-0}" == "1" && -d "${BACKUP_DIR}/plugin_dir" ]]; then
  rm -rf "${PLUGIN_DST}"
  cp -a "${BACKUP_DIR}/plugin_dir" "${PLUGIN_DST}"
else
  if [[ "${PREV_INDEX_EXISTS:-0}" == "1" ]]; then
    cp -f "${BACKUP_DIR}/index.ts" "${PLUGIN_DST}/index.ts"
  else
    rm -f "${PLUGIN_DST}/index.ts"
  fi

  if [[ "${PREV_MANIFEST_EXISTS:-0}" == "1" ]]; then
    cp -f "${BACKUP_DIR}/openclaw.plugin.json" "${PLUGIN_DST}/openclaw.plugin.json"
  else
    rm -f "${PLUGIN_DST}/openclaw.plugin.json"
  fi

  if [[ "${PREV_PLUGIN_DIR_EXISTS:-0}" != "1" ]]; then
    rmdir "${PLUGIN_DST}" 2>/dev/null || true
  fi
fi

if [[ "${PREV_OPENCLAW_CONFIG_EXISTS:-0}" == "1" ]]; then
  cp -f "${BACKUP_DIR}/openclaw.json" "${OPENCLAW_CONFIG_PATH}"
fi

if [[ "${CREATED_CONFIG_PATH:-0}" == "1" ]]; then
  rm -f "${CONFIG_PATH}"
fi

if [[ "${NO_RESTART}" != "1" && -n "${OPENCLAW_BIN}" ]]; then
  "${OPENCLAW_BIN}" daemon restart || true
fi

echo "Restored from backup: ${BACKUP_DIR}"
echo "Plugin path restored: ${PLUGIN_DST}"
if [[ "${PREV_OPENCLAW_CONFIG_EXISTS:-0}" == "1" ]]; then
  echo "OpenClaw config restored: ${OPENCLAW_CONFIG_PATH}"
fi
if [[ "${CREATED_CONFIG_PATH:-0}" == "1" ]]; then
  echo "Removed config created by install: ${CONFIG_PATH}"
fi

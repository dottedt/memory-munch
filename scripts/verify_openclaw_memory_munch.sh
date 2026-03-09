#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw || true)}"
CUSTOM_QUERY="${1:-}"

if [[ -z "${OPENCLAW_BIN}" ]]; then
  echo "openclaw CLI not found in PATH." >&2
  exit 1
fi

echo "== Plugin info =="
"${OPENCLAW_BIN}" plugins info memory-munch-tools --json

echo
echo "== Native memory status =="
"${OPENCLAW_BIN}" memory status --json

if [[ -n "${CUSTOM_QUERY}" ]]; then
  echo
  echo "== Agent query (live mode) =="
  "${OPENCLAW_BIN}" agent --agent main --message "${CUSTOM_QUERY}" --json
  exit 0
fi

echo
echo "== Isolated one-shot verification (no user memory required) =="

ORIG_CFG_JSON="$("${OPENCLAW_BIN}" config get --json plugins.entries.memory-munch-tools.config)"
TMP_DIR="$(mktemp -d /tmp/memory-munch-verify.XXXXXX)"
TMP_ROOT="${TMP_DIR}/workspace"
TMP_CFG="${TMP_ROOT}/dmemorymunch-mpc.toml"
TMP_MEM="${TMP_ROOT}/memory/verify-once.md"
VERIFY_TOKEN="MM_VERIFY_TOKEN_$(date +%s)"

cleanup() {
  set +e
  if [[ -n "${ORIG_CFG_JSON:-}" ]]; then
    "${OPENCLAW_BIN}" config set --strict-json plugins.entries.memory-munch-tools.config "${ORIG_CFG_JSON}" >/dev/null
    "${OPENCLAW_BIN}" daemon restart >/dev/null
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

mkdir -p "${TMP_ROOT}/memory"
cat > "${TMP_MEM}" <<EOF
# One-shot verify

Question: What is the Answer to the Ultimate Question of Life, the Universe, and Everything?
Answer: 42
Tag: ${VERIFY_TOKEN}
This file is temporary and should be removed after verification.
EOF

cat > "${TMP_CFG}" <<EOF
db_path = ".memorymunch/memory.db"
roots = ["${TMP_ROOT}"]
include_globs = ["MEMORY.md", "memory/**/*.md"]
exclude_globs = []
follow_symlinks = false
max_tokens_per_query = 1200
snippet_chars = 200
EOF

PYTHON_BIN="$(python3 - <<'PY' "${ORIG_CFG_JSON}"
import json, sys
cfg = json.loads(sys.argv[1])
print((cfg.get("pythonBin") or "python3").strip())
PY
)"

if [[ -x "$(dirname "${PYTHON_BIN}")/dmemorymunch-mpc-admin" ]]; then
  ADMIN_BIN="$(dirname "${PYTHON_BIN}")/dmemorymunch-mpc-admin"
  "${ADMIN_BIN}" index --scope all --config "${TMP_CFG}" >/dev/null
else
  "${PYTHON_BIN}" -m dmemorymunch_mpc.cli index --scope all --config "${TMP_CFG}" >/dev/null
fi

"${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.configPath "${TMP_CFG}" >/dev/null
"${OPENCLAW_BIN}" config set plugins.entries.memory-munch-tools.config.autoIndexWatch false >/dev/null
"${OPENCLAW_BIN}" daemon restart >/dev/null

QUERY="Use memory_search with query \"Ultimate Question of Life, the Universe, and Everything\". If memory results contain the answer, reply exactly 42. Otherwise reply exactly MM_VERIFY_FAIL."
RESULT_JSON="$("${OPENCLAW_BIN}" agent --agent main --message "${QUERY}" --json)"
echo "${RESULT_JSON}"

RESULT_TEXT="$(python3 - <<'PY' "${RESULT_JSON}"
import json, sys
data = json.loads(sys.argv[1])
payloads = data.get("result", {}).get("payloads", [])
text = payloads[0].get("text", "") if payloads else ""
print(text.strip())
PY
)"

if [[ "${RESULT_TEXT}" != "42" ]]; then
  echo "Isolated verification failed. Expected 42, got: ${RESULT_TEXT}" >&2
  exit 1
fi

echo
echo "Isolated verification passed."

#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-/home/scott/.npm-global/bin/openclaw}"
AGENT_ID="${AGENT_ID:-main}"
SESSION_ID="${SESSION_ID:-bughunt-$(date +%s)}"

if [[ ! -x "${OPENCLAW_BIN}" ]]; then
  echo "OpenClaw binary not executable: ${OPENCLAW_BIN}" >&2
  exit 1
fi

QUESTIONS=(
  "Which lead asked for temporary searchable inbox before CRM sync?"
  "What is that lead's phone number?"
  "Who owns the convention inbox processing queue right now?"
  "What city is Adam Rodriguez based in?"
  "What is Jordan's home Wi-Fi SSID?"
)

echo "agent=${AGENT_ID}"
echo "session=${SESSION_ID}"

for q in "${QUESTIONS[@]}"; do
  echo
  echo "=== Q: ${q}"
  "${OPENCLAW_BIN}" agent --agent "${AGENT_ID}" --session-id "${SESSION_ID}" --message "${q}" --json \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); p=d.get("result",{}).get("payloads",[]); print(p[-1]["text"] if p else "<no-payload>")'
done


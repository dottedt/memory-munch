#!/usr/bin/env bash
set -euo pipefail

OPENCLAW="${OPENCLAW_BIN:-/home/scott/.npm-global/bin/openclaw}"
SESSION_PREFIX="${SESSION_PREFIX:-smoke}"

declare -a QUESTIONS=(
  "What city is Adam Rodriguez based in? Answer with city and state only."
  "Which lead asked for temporary searchable inbox before CRM sync? Give only the full name."
  "What is that lead's phone number? Give only the phone number."
  "Who owns the convention inbox processing queue right now? Give only the full name."
  "Which lead requested a pricing sheet and security one-pager? Give only the full name."
  "What follow-up time preference did Sophie Tran give? One short sentence."
  "Which Slack channel is mentioned for deployment status checks? Return only channel name."
  "Who should receive the end-of-day summary in the January journal? Give only full name."
  "Which CRM snapshot date is explicitly said to predate convention cards? Return date only."
  "What is Jordan's home Wi-Fi SSID? Return only SSID."
)

for i in "${!QUESTIONS[@]}"; do
  n=$((i + 1))
  sid="${SESSION_PREFIX}-${n}"
  msg="${QUESTIONS[$i]}"
  out="/tmp/mm_smoke_${n}.json"
  "$OPENCLAW" agent --agent main --session-id "$sid" --message "$msg" --json > "$out"
  ans="$(jq -r '.result.payloads[0].text // ""' "$out" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  use="$(jq -r '.result.meta.agentMeta.usage.total // 0' "$out")"
  echo "Q${n}: ${msg}"
  echo "A${n}: ${ans}"
  echo "T${n}: total_tokens=${use}"
  echo
done

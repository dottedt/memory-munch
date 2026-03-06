#!/usr/bin/env bash
set -euo pipefail

OPENCLAW="${OPENCLAW_BIN:-/home/scott/.npm-global/bin/openclaw}"

"$OPENCLAW" gateway restart >/tmp/mm_bounce.out 2>&1 || true

"$OPENCLAW" agent --agent main --session-id auto-duel-1 \
  --message "What city is Adam Rodriguez based in? Answer with city and state only." \
  --json > /tmp/mm_duel1.json

"$OPENCLAW" agent --agent main --session-id auto-duel-2 \
  --message "Which lead asked for temporary searchable inbox before CRM sync? Give only the full name." \
  --json > /tmp/mm_duel2.json

"$OPENCLAW" agent --agent main --session-id auto-duel-3 \
  --message "What is the phone number for that lead? Give only the phone number." \
  --json > /tmp/mm_duel3.json

printf 'DUEL1\n'
jq -r '.result.payloads[].text' /tmp/mm_duel1.json
printf '\nDUEL2\n'
jq -r '.result.payloads[].text' /tmp/mm_duel2.json
printf '\nDUEL3\n'
jq -r '.result.payloads[].text' /tmp/mm_duel3.json
printf '\nUSAGE\n'
jq -r '.result.meta.agentMeta.usage | @json' /tmp/mm_duel1.json
jq -r '.result.meta.agentMeta.usage | @json' /tmp/mm_duel2.json
jq -r '.result.meta.agentMeta.usage | @json' /tmp/mm_duel3.json

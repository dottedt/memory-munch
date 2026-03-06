# Memory-Munch Test Questions (with Expected Answers)

## How to use
Ask these in OpenClaw and verify answers by source/path.

1. What is Jordan's home Wi-Fi SSID?
Expected: MillHouse-5G
Source: MEMORY.md (Home Network)

2. Who is Jordan's manager?
Expected: Priya Shah
Source: MEMORY.md (Important Contacts)

3. What is the Cedar launch target date?
Expected: 2026-04-15
Source: MEMORY.md + memory/projects/cedar-project.md

4. Which Slack channel is the primary alert channel?
Expected: #launch-ops
Source: memory/ops/runbooks.md

5. What is the staging webhook endpoint?
Expected: https://hooks.internal.test/staging
Source: MEMORY.md

6. What is Jordan's caffeine cutoff time?
Expected: 2:00 PM local
Source: MEMORY.md (Health & Routine)

7. What is the printer IP?
Expected: 192.168.10.45
Source: MEMORY.md (Home Network)

8. Who owns networking/secrets rotation?
Expected: Daniel Cho
Source: MEMORY.md + memory/people/people-index.md

9. What is the utility account for electricity?
Expected: AU-993144
Source: memory/personal/household.md

10. Which channel repeatedly discusses deploy windows?
Expected: #launch-ops
Source: memory/slack/launch-ops-threads.md

## Retrieval behavior checks
- Ask a very specific path-like question: "What does long-lived work facts say about demo host?"
- Ask a discovery question: "What people-related notes do we have about communication preferences?"
- Ask a fallback keyword question: "Where is rollback plan mentioned?"

## Token-efficiency checks
- Ensure search results are snippets, not full files.
- Ensure full chunk text is only returned on explicit chunk fetch.
- Compare answers from narrow path lookup vs broad text search.

## Convention Inbox (Not Yet in CRM)
11. Who from Skybridge Realty Group did we meet, and what follow-up window was requested?
Expected: Elena Park; next Tuesday morning.
Source: memory/inbox/2026-03-05-convention-business-cards.md

12. Which lead asked for a temporary searchable inbox before CRM sync?
Expected: Adam Rodriguez (Harbor Key Properties).
Source: memory/inbox/2026-03-05-convention-business-cards.md

13. Which convention leads are NOT YET in CRM snapshot?
Expected: Elena Park, Marcus D. Lee, Prianca Nair, Adam Rodriguez, Sophie Tran.
Source: memory/inbox/2026-03-05-convention-business-cards.md + memory/crm/contacts-snapshot-2026-03-01.md

14. Who requested WhatsApp integration and what was their concern?
Expected: Marcus D. Lee; over-long memory files / context lookup speed.
Source: memory/inbox/2026-03-05-convention-business-cards.md

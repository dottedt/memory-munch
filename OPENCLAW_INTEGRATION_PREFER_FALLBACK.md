# OpenClaw Integration: Prefer Memory-Munch, Fallback Native Memory

## Goal
Use Memory-Munch first for memory retrieval, then fallback to OpenClaw native memory tools when Memory-Munch has no confident hit.

This is **not** an override of native memory. It is priority + fallback.

## Required Runtime Behavior
1. Agent attempts Memory-Munch tools first:
   - `memory_munch_path_root`
   - `memory_munch_path_children`
   - `memory_munch_path_lookup`
   - `memory_munch_text_search`
   - `memory_munch_chunk_fetch`
2. If no confident hit, agent calls native tools:
   - `memory_search`
   - `memory_get`
3. Agent response should indicate fallback occurred when native tools were used.

## Integration Contract (OpenClaw Side)
Expose Memory-Munch MCP tools in the same callable tool catalog used by the agent runtime.

- Do not replace/remove `memory_search` / `memory_get`.
- Add a tool-policy/system-prompt rule:
  - "Use `memory_munch_*` first for memory/history questions."
  - "Fallback to `memory_search` then `memory_get` only if Memory-Munch returns no confident match."

## Confidence Rule
Memory-Munch is considered "no confident hit" when either condition is true:
- `data.items` is empty, or
- top result score is below configured threshold (start with `score < 1.2`, tune later).

## Token Budget Rules
- Initial budget per memory turn: `max_tokens=700`.
- Hard cap: `1200`.
- Path-based lookup preferred over free-text search.
- Do not inject full markdown files.

## Minimal Fallback Flow
1. Try path navigation/lookup (`path_root` -> `path_children` -> `path_lookup`).
2. If still no hit, run `memory_munch_text_search`.
3. If still no confident hit, run native `memory_search`.
4. Use native `memory_get` only for targeted lines.

## Observability
Track these metrics per query:
- `mm_used` (bool)
- `mm_hits`
- `mm_top_score`
- `native_fallback_used` (bool)
- `tokens_saved` (from Memory-Munch `_meta` when available)

## Acceptance Tests
1. Known deterministic fact:
   - Query: "Which lead asked for temporary searchable inbox before CRM sync?"
   - Expected: Memory-Munch hit first, returns Adam Rodriguez / Harbor Key Properties.
2. Unknown path but known text:
   - Query should resolve through `memory_munch_text_search` without native fallback.
3. True no-hit query:
   - Memory-Munch no-hit, then native memory tools are attempted.
4. Token control:
   - Retrieval payload remains under configured cap.

## Non-Goals
- No vector-first pipeline.
- No full-document injection.
- No replacement of OpenClaw's native memory implementation.

## Cleanup Status (Completed)
Temporary exec bridge artifacts were removed from `~/.openclaw/workspace`:
- removed `mm-tool`
- removed "Memory-Munch Bridge (Exec)" section from workspace `AGENTS.md`


# AGENTS.md

## Retrieval Policy (Mandatory)

This policy applies to documentation, skills, memory, process, and guidance requests.

Code task policy is intentionally excluded for now.

### Default Behavior

1. Use `dmemorymunch-mpc` first for relevant requests.
2. Do not answer from prior memory when indexed retrieval is available.
3. Only use broad file reads if indexed retrieval is insufficient.

### Required Retrieval Flow

1. Call `search_within_path(path_prefix=..., query=...)`.
2. Select relevant nodes and call `get_by_path(path=...)`.
3. Base the response only on retrieved node content.

### No-Hit Behavior

If relevant nodes are not found:

1. Return `NO_INDEX_HIT`.
2. State that index results were insufficient.
3. Suggest reindexing or a refined query/path prefix.

### Response Requirements

Every response based on indexed memory must include:

1. The `knowledge_path` values used.
2. A short note if fallback behavior was used.

### Scope Guidance

Prefer these path prefixes when applicable:

1. `home.codex` for installed Codex skills and references.
2. `project.` for repository-local memory/docs.
3. `home.claude` or `home.cursor` when those roots are enabled.

## Memory-Munch MCP Tool Directives (Mandatory)

### Overview

1. Memory-Munch is the primary structured memory system.
2. Do not load raw Markdown memory files into context when Memory-Munch tools are available.
3. Treat memory as a deterministic hierarchy of lookup paths, not as free-form document search.

### MCP Tools (Current)

1. `memory_munch_path_root`
2. `memory_munch_path_children`
3. `memory_munch_path_lookup`
4. `memory_munch_text_search`
5. `memory_munch_chunk_fetch`

### Path Construction Rules

1. Lookup paths follow `domain.section.topic`.
2. Typical domains: `agents`, `projects`, `runbooks`, `peopleindex`, `profile`.
3. Build likely paths by mapping question intent:
4. Identify domain.
5. Identify section/category.
6. Identify specific topic.
7. Example: "How does the agent load context from memory?" -> `agents.instructions.context_loading`.

### Preferred Retrieval Order

1. `memory_munch_path_lookup` when a likely path can be inferred.
2. If domain is unknown: `memory_munch_path_root` -> `memory_munch_path_children` -> `memory_munch_path_lookup`.
3. `memory_munch_text_search` only when path navigation does not produce a usable hit.
4. `memory_munch_chunk_fetch` only for shortlisted chunk IDs when snippet text is insufficient.

This order is aligned to the current Memory-Munch implementation:
1. `memory_lookup_paths` table enables deterministic path traversal.
2. `memory_terms` supports reverse-term lookup when paths are uncertain.
3. `memory_facts` supports subject/predicate questions (phone/email/SSID/follow-up/title/company).
4. `memory_fts` is keyword fallback with staged query variants.

### Deterministic Navigation Rules

1. Start with path-based retrieval whenever possible.
2. Use `memory_munch_path_root` only when top-level domain is unknown.
3. Use `memory_munch_path_children` to walk down the hierarchy before keyword search.
4. Run `memory_munch_path_lookup` again after discovering candidate paths.
5. Use `memory_munch_text_search` only if path lookup/navigation does not resolve a hit.

### If Path Lookup Fails

1. If `memory_munch_path_lookup` returns no results, do not repeat the same call.
2. Use `memory_munch_path_children` to inspect nearby hierarchy.
3. Retry with revised path candidates.
4. Use `memory_munch_text_search` only after hierarchy exploration is insufficient.

### Token Efficiency Rules

1. Never retrieve whole documents.
2. Fetch the minimum number of chunks needed to answer.
3. Do not call `memory_munch_chunk_fetch` unless snippet-level results are insufficient.
4. Prefer deterministic path hits over broad keyword queries.

### Retrieval Limits

1. Prefer retrieving 1-3 relevant chunks.
2. Avoid repeated retrieval calls unless additional context is required.
3. Do not fetch broad result sets unless the user explicitly asks for exhaustive output.

### Snippet Handling

1. `memory_munch_path_lookup` and `memory_munch_text_search` may return snippets.
2. Snippets are for triage and ranking, not guaranteed full context.
3. Use `memory_munch_chunk_fetch` when full chunk text is required.

### Chunk Ordering

1. Chunks from the same path are sequential.
2. Interpret related chunks in ascending `chunk_order`.
3. Preserve order when combining multiple chunks into one answer.

### Prefix Path Behavior

1. Prefix/section paths can return multiple subtopic chunks.
2. Example: `agents.tools` may include `agents.tools.memory`, `agents.tools.filesystem`, and related descendants.
3. Use `memory_munch_path_children` to refine before broad retrieval.

### Fact Question Rules

For questions like phone/email/SSID/follow-up preference/company/title:

1. Try path-first lookup for the likely entity or section.
2. If unknown, use path navigation (`root` -> `children` -> `lookup`).
3. Use `memory_munch_text_search` as fallback; it is fact-aware in current Memory-Munch (`memory_facts` + terms + FTS stages).
4. Use `memory_munch_chunk_fetch` only for the specific chunk(s) needed for exact value extraction.

### Tool Retry Rule

1. On tool failure/no-hit: revise path -> explore children -> fallback to text search.
2. Avoid identical repeated tool calls with unchanged inputs.
3. Stop retry loops when two strategy changes still return no useful hits; report uncertainty clearly.

### Important System Rule

Memory-Munch is a deterministic structured memory index. It is not a vector-first memory system.

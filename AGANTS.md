# AGANTS.md

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

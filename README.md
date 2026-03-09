<p align="center">
  <img src="memory-munch-logo.png" alt="memory-munch" width="200" />
</p>

# memory-munch

Better memory retrieval for OpenClaw. Fast, local, and token safe.

**memory-munch** is an OpenClaw plugin with an MCP-backed retrieval layer that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes model-facing memory tools for deterministic path-first retrieval.

No embedding model. No external services. No cloud calls. Just local keyword/path retrieval with hard token caps so it never blows up your context window.

When memory-munch has no confident hit, it can fall back to OpenClaw's native vector memory search so recall remains robust.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

## Quick Start

If you already have OpenClaw and Python 3.11+, this is the fastest path:

```bash
pip install -e .
./scripts/install_openclaw_memory_munch_plugin.sh
./scripts/verify_openclaw_memory_munch.sh "Which lead asked for temporary searchable inbox before CRM sync? Give just the name."
```

## Installation

### 1) Prerequisites

- Python `3.11+`
- OpenClaw CLI available in your shell

Check:

```bash
python3 --version
openclaw --version
```

### 2) Install memory-munch

```bash
pip install -e .
# or (if you use uv)
uv pip install -e .
```

### 3) Install plugin into OpenClaw

```bash
./scripts/install_openclaw_memory_munch_plugin.sh
```

Default plugin behavior:

- `autoIndexWatch=true` (plugin-managed background index watcher)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`

### 4) Verify installation

```bash
./scripts/verify_openclaw_memory_munch.sh "Which lead asked for temporary searchable inbox before CRM sync? Give just the name."
```

## Indexing

Indexing is automatic by default through the plugin service (`autoIndexWatch=true`).
In normal use, you should not need manual indexing commands.

Use manual indexing only for recovery/debug cases (for example, after moving
large memory folders or resetting state):

```bash
dmemorymunch-mpc-admin init-db
dmemorymunch-mpc-admin index --scope all
```

Config file location: `~/.openclaw/workspace/dmemorymunch-mpc.toml`

Edit `roots` only if your memory directories live outside the default OpenClaw workspace.

Optional: disable automatic watcher

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

## Credits

`memory-munch` was inspired by **jcodemunch-mcp** by JJ Gravelle:

- https://github.com/jgravelle/jcodemunch-mcp
- https://www.youtube.com/@jjgravelle

If you do coding work with OpenClaw and want to save tokens, definitely check
out his work.

<p align="center">
  <img src="memory-munch-logo.png" alt="memory-munch" width="200" />
</p>

# memory-munch

Better memory retrieval for OpenClaw. Fast, local, and token safe.

**memory-munch** is an OpenClaw plugin with an MCP-backed retrieval layer that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes model-facing memory tools for deterministic path-first retrieval.

No embedding model. No external services. No cloud calls. Just local keyword/path retrieval with hard token caps so it never blows up your context window.

When memory-munch has no confident hit, it can fall back to OpenClaw's native vector memory search so recall remains robust.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

## Installation (from zero)

### 1) Prerequisites

- Python `3.11+`
- OpenClaw installed (`openclaw` command works)
- Git

Check prerequisites:

```bash
python3 --version
openclaw --version
git --version
```

### 2) Download memory-munch and enter the directory

```bash
git clone http://192.168.86.2:3000/scott/memory-munch.git
cd memory-munch
```

### 3) Install the Python package

```bash
pip install -e .
# or, if you use uv:
uv pip install -e .
```

### 4) Install the OpenClaw plugin

```bash
bash ./scripts/install_openclaw_memory_munch_plugin.sh
```

### 5) Verify installation

```bash
bash ./scripts/verify_openclaw_memory_munch.sh
```

This runs an isolated one-shot verification (Hitchhiker's Guide / answer `42`)
that does not depend on your personal memory files.

Default plugin behavior after install:

- `autoIndexWatch=true` (plugin-managed background index watcher)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`

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

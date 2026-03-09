<p align="center">
  <img src="memory-munch-logo.png" alt="memory-munch" width="200" />
</p>

# memory-munch

Better memory retrieval for OpenClaw. Fast, local, and token safe.

**memory-munch** is an OpenClaw plugin with an MCP-backed retrieval layer that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes model-facing memory tools for deterministic path-first retrieval.

No embedding model. No external services. No cloud calls. Just local keyword/path retrieval with hard token caps so it never blows up your context window.

When memory-munch has no confident hit, it can fall back to OpenClaw's native vector memory search so recall remains robust.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

## Install

If you are starting from scratch, follow these steps in order.

### Step 1. Check prerequisites

You need:

- Python `3.11` or newer
- OpenClaw installed and available in your shell (`openclaw` command)

Quick check:

```bash
python3 --version
openclaw --version
```

If either command fails, install that dependency first.

### Step 2. Install memory-munch (Python package)

```bash
pip install -e .
# or with uv
uv pip install -e .
```

### Step 3. Install the plugin into OpenClaw

```bash
./scripts/install_openclaw_memory_munch_plugin.sh
```

Defaults now:

- `autoIndexWatch=true` (plugin-managed background watcher via OpenClaw service)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`

### Step 4. Confirm it works

```bash
./scripts/verify_openclaw_memory_munch.sh "Which lead asked for temporary searchable inbox before CRM sync? Give just the name."
```

### Step 5. Optional settings

Disable automatic indexing watcher if needed:

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

## Indexing behavior (important)

`memory-munch` keeps the index up to date automatically through the plugin-managed
watcher service (`autoIndexWatch=true` by default). You normally do not need to
run indexing commands yourself.

Run manual commands only for rare recovery/debug cases (for example after moving
large memory folders or resetting state):

```bash
dmemorymunch-mpc-admin init-db
dmemorymunch-mpc-admin index --scope all
```

Your config file is at `~/.openclaw/workspace/dmemorymunch-mpc.toml`.
Only edit `roots` if your memory directories live outside the default OpenClaw
workspace.

## Credits

`memory-munch` was inspired by **jcodemunch-mcp** by JJ Gravelle:

- https://github.com/jgravelle/jcodemunch-mcp
- https://www.youtube.com/@jjgravelle

If you do coding work with OpenClaw and want to save tokens, definitely check
out his work.

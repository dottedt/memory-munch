<p align="center">
  <img src="memory-munch-logo.png" alt="memory-munch" width="200" />
</p>

# memory-munch

Better memory retrieval for OpenClaw. Fast, local, and token safe.

**memory-munch** is an OpenClaw plugin that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes five retrieval tools that OpenClaw can call instead of loading your memory files wholesale into context.

No embedding model. No external services. No cloud calls. Just keyword search against a local index, capped at a hard token limit so it never blows up your context window.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

## Install

Requires Python 3.11+ and a working OpenClaw installation.

### Step 1. Install the Python package

```bash
pip install -e .
# or with uv
uv pip install -e .
```

### Step 2. Install plugin into OpenClaw

```bash
./scripts/install_openclaw_memory_munch_plugin.sh
```

Defaults now:

- `autoIndexWatch=true` (plugin-managed background watcher via OpenClaw service)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`

Disable the watcher if needed:

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

### Step 3. Indexing is automatic (manual only for recovery)

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

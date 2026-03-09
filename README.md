<p align="center">
  <img src="memory-munch-logo.png" alt="memory-munch" width="200" />
</p>

# memory-munch

Better memory retrieval for OpenClaw. Fast, local, and token safe.

## Credits

`memory-munch` was inspired by **jcodemunch-mcp** by JJ Gravelle:

- https://github.com/jgravelle/jcodemunch-mcp
- https://www.youtube.com/@jjgravelle

If you do coding work with AI and want to save a butt ton of tokens, definitely check out J. Gravelle's work. Tell him DottedT says HI.

**memory-munch** is an OpenClaw plugin with an MCP-backed retrieval layer that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes model-facing memory tools for deterministic path-first retrieval.

No embedding model. No external services. No cloud calls. Just local keyword/path retrieval with hard token caps so it never blows up your context window.

When memory-munch has no confident hit, it falls back to OpenClaw's native vector memory search. It will still return a useful memory result path when possible.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

## License

Free for personal and non-commercial use.

If a company wants to incorporate memory-munch into internal systems, products, or services, a paid commercial license is required from the project owner. See [`LICENSE`](LICENSE).

## Installation (from zero)

### 1) Prerequisites
Python 3.11+
OpenClaw installed (openclaw command works)
Git

Check prerequisites:

```bash
python3 --version
openclaw --version
git --version
```

### 2) Download memory-munch and enter the directory

```bash
git clone https://github.com/dottedt/memory-munch.git
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

## Verify Installation (Self-Test)

```bash
bash ./scripts/verify_openclaw_memory_munch.sh
```

This runs an isolated one-shot verification (Hitchhiker's Guide / answer `42`)
that does not depend on your personal memory files.

This verification is only a self-test. It does not index or modify your real memory workspace.

## Runtime Defaults (Real Use)

- `autoIndexWatch=true` (plugin-managed background index watcher)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`
- `roots=["~/.openclaw/workspace"]` in `~/.openclaw/workspace/dmemorymunch-mpc.toml`

Config file location: `~/.openclaw/workspace/dmemorymunch-mpc.toml`

Edit `roots` only if your memory directories live outside the default OpenClaw workspace.

Optional: disable automatic watcher

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

## Indexing

With `autoIndexWatch=true`, the plugin starts a watcher that:
- runs an initial full index of your real memory files
- then keeps the index updated as files change

In normal use, you should not need manual indexing commands.

Use manual indexing only for recovery/debug cases (for example, after moving
large memory folders or resetting state):

```bash
dmemorymunch-mpc-admin init-db
dmemorymunch-mpc-admin index --scope all
```

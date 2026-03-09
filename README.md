<p align="center">
  <img src="memory-munch-logo.png" alt="Memory-Munch" width="200" />
</p>

# Memory-Munch

[![npm version](https://img.shields.io/npm/v/%40dottedt%2Fmemory-munch-tools)](https://www.npmjs.com/package/@dottedt/memory-munch-tools)
[![OpenClaw Community PR](https://img.shields.io/badge/OpenClaw-community%20plugins-blue)](https://docs.openclaw.ai/plugins/community)

Better memory retrieval for OpenClaw. It's deterministic memory retrieval that's fast, local, and token-efficient.

## Credits

Memory-Munch was inspired by **jcodemunch-mcp** by JJ Gravelle:

- https://github.com/jgravelle/jcodemunch-mcp
- https://www.youtube.com/@jjgravelle

If you do coding work with AI and want to save a butt ton of tokens, definitely check out J. Gravelle's work. Tell him DottedT says HI.

---

**Memory-Munch** is an OpenClaw plugin with an MCP-backed retrieval layer that gives your assistant smarter access to your memory files. It indexes `MEMORY.md` and your `memory/` folder into a local SQLite database and exposes model-facing memory tools for deterministic path-first retrieval.

No embedding model. No external services. No cloud calls. Just local keyword/path retrieval with hard token caps so it never blows up your context window.

When Memory-Munch has no confident hit, it falls back to OpenClaw's native vector memory search automatically.

If you use OpenClaw's memory and find it dumping too much, or too little, into context, this is for you.

Why this is better than standard OpenClaw memory search (brief):
- Path-first retrieval gives more deterministic hits when your memory is structured.
- Hard token caps avoid context blowups from large memory pulls.
- Local indexed lookup keeps answers fast and predictable.
- Native OpenClaw vector memory still acts as fallback when Memory-Munch has no confident hit.

## License

Free for personal and non-commercial use.

If a company wants to incorporate Memory-Munch into internal systems, products, or services, a paid commercial license is required from the project owner. See [`LICENSE`](LICENSE).

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

### 2) Download Memory-Munch and enter the directory

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

Install safety:
- Non-destructive for the rest of OpenClaw config.
- Only Memory-Munch-managed keys are changed (`plugins.entries.memory-munch-tools.*`, `plugins.slots.memory`, and optionally `plugins.allow`).
- A backup snapshot is created before changes.

The installer prints:
- backup snapshot location
- plugin file diff report (`plugin_dir.diff`)

## Uninstall / Rollback

```bash
bash ./scripts/undo_openclaw_memory_munch_install.sh
```

Rollback restores only Memory-Munch-managed OpenClaw keys and plugin files from the captured install snapshot. It does not overwrite your entire `~/.openclaw/openclaw.json`.

Use a specific snapshot if needed:

```bash
bash ./scripts/undo_openclaw_memory_munch_install.sh --backup-dir ~/.openclaw/backups/memory-munch-tools/<snapshot-id>
```

## Verify Installation (Self-Test)

```bash
bash ./scripts/verify_openclaw_memory_munch.sh
```

This runs an isolated one-shot verification (Hitchhiker's Guide / answer `42`)
that does not depend on your personal memory files.

This verification is only a self-test. It does not index or modify your real memory workspace.

## Runtime Defaults

- `autoIndexWatch=true` (plugin-managed background index watcher)
- `autoInjectPromptContext=false`
- `exposeRawTools=false`
- `roots=["~/.openclaw/workspace"]` in `~/.openclaw/workspace/dmemorymunch-mpc.toml`

Config file location: `~/.openclaw/workspace/dmemorymunch-mpc.toml`

Edit `roots` only if your memory directories live outside the default OpenClaw workspace.

Optional: re-apply runtime defaults

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch true
openclaw config set plugins.entries.memory-munch-tools.config.autoInjectPromptContext false
openclaw config set plugins.entries.memory-munch-tools.config.exposeRawTools false
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

Optional: disable automatic watcher

```bash
openclaw config set plugins.entries.memory-munch-tools.config.autoIndexWatch false
openclaw daemon restart
```

## Publish (npm + OpenClaw Community Listing)

### Publish plugin package to npm

```bash
cd extensions/memory-munch-tools
npm login
npm publish --access public
```

Package name in this repo: `@dottedt/memory-munch-tools`

### Verify npm install path works

```bash
openclaw plugins install @dottedt/memory-munch-tools
openclaw daemon restart
openclaw plugins info memory-munch-tools --json
```

### Submit to OpenClaw community list

Requirements are documented here:
`https://docs.openclaw.ai/plugins/community#required-for-listing`

Include:
- npm package link
- GitHub source link
- setup/docs link (this README)
- issue tracker link

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

type PluginCfg = {
  pythonBin?: string;
  bridgeScript?: string;
  configPath?: string;
  timeoutMs?: number;
};

function resolveCfg(api: OpenClawPluginApi): Required<PluginCfg> {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const home = process.env.HOME || "";
  const defaultWorkspace = home ? `${home}/.openclaw/workspace` : ".";
  return {
    pythonBin: cfg.pythonBin?.trim() || process.env.MEMORY_MUNCH_PYTHON || "python3",
    bridgeScript:
      cfg.bridgeScript?.trim() || process.env.MEMORY_MUNCH_BRIDGE || "openclaw_memory_munch_bridge.py",
    configPath: cfg.configPath?.trim() || process.env.MEMORY_MUNCH_CONFIG || `${defaultWorkspace}/dmemorymunch-mpc.toml`,
    timeoutMs:
      typeof cfg.timeoutMs === "number" && cfg.timeoutMs >= 1000 ? Math.floor(cfg.timeoutMs) : 15000,
  };
}

async function runBridge(api: OpenClawPluginApi, args: string[]): Promise<unknown> {
  const cfg = resolveCfg(api);
  return await new Promise((resolve, reject) => {
    const proc = spawn(cfg.pythonBin, [cfg.bridgeScript, "--config", cfg.configPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let out = "";
    let err = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(new Error(`memory-munch bridge timed out after ${cfg.timeoutMs}ms`));
    }, cfg.timeoutMs);

    proc.stdout.on("data", (d) => {
      out += String(d);
    });
    proc.stderr.on("data", (d) => {
      err += String(d);
    });

    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(e);
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`bridge failed (${code}): ${err || out}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim() || "{}"));
      } catch (e) {
        reject(new Error(`bridge returned invalid JSON: ${String(e)} :: ${out}`));
      }
    });
  });
}

function asToolResponse(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: { json: payload },
  };
}

function asLegacyMemorySearch(payload: unknown) {
  const p = payload as { data?: { items?: unknown[] }; [k: string]: unknown };
  const items = Array.isArray(p?.data?.items) ? p.data.items.map(stripSourceFields) : [];
  return {
    results: items,
    provider: "memory-munch",
    model: "sqlite-fts5",
    fallback: false,
    citations: "off",
    mode: "memory-munch",
  };
}

function stripSourceFields(item: unknown): unknown {
  const row = { ...(item as Record<string, unknown>) };
  // Remove internal file-system fields the model doesn't need.
  // Keep chunk_id and lookup_path — the model needs them for chunk_fetch / path_lookup follow-ups.
  delete row.path;
  delete row.startLine;
  delete row.endLine;
  delete row.from;
  delete row.lines;
  delete row.parent_path;
  delete row.source_file;
  delete row.chunk_order;
  return row;
}


function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function queryTokens(query: string): string[] {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "at",
    "is",
    "are",
    "was",
    "were",
    "be",
    "before",
    "after",
    "with",
    "by",
    "from",
    "who",
    "what",
    "when",
    "where",
    "which",
    "how",
    "did",
    "does",
    "do",
  ]);
  return query
    .split(/\s+/)
    .map(normalizeToken)
    .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t));
}

function rerankItemsForQuery(items: unknown[], query: string, maxResults: number): unknown[] {
  const qTokens = queryTokens(query);
  if (qTokens.length === 0) return items.slice(0, maxResults);
  const scored = items
    .map((item) => {
      const row = item as Record<string, unknown>;
      const snippet = String(row.snippet ?? "");
      const lookupPath = String(row.lookup_path ?? "");
      const hay = `${snippet} ${lookupPath}`.toLowerCase();
      let overlap = 0;
      for (const tok of qTokens) {
        if (hay.includes(tok)) overlap += 1;
      }
      const ratio = overlap / qTokens.length;
      const baseScore = typeof row.score === "number" ? row.score : 0;
      const combined = baseScore + ratio * 10;
      return { item, combined };
    })
    .sort((a, b) => b.combined - a.combined);
  // Data comes first — never filter out items, just reorder.
  return scored.slice(0, maxResults).map((s) => s.item);
}


async function runMemoryGetFromFile(api: OpenClawPluginApi, params: Record<string, unknown>) {
  const relPath = typeof params.path === "string" ? params.path.trim() : "";
  if (!relPath) throw new Error("path is required");
  const from = typeof params.from === "number" ? Math.max(1, Math.trunc(params.from)) : 1;
  const lines = typeof params.lines === "number" ? Math.max(1, Math.trunc(params.lines)) : 20;
  const cfg = resolveCfg(api);
  const workspace = path.resolve(path.dirname(cfg.configPath));
  const abs = path.resolve(workspace, relPath);
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) {
    throw new Error(`path must be within workspace: ${relPath}`);
  }
  const data = await readFile(abs, "utf-8");
  const all = data.split(/\r?\n/);
  const start = Math.max(1, from);
  const end = Math.min(all.length, start + lines - 1);
  const text = all.slice(start - 1, end).join("\n");
  return {
    path: relPath,
    from: start,
    lines: end >= start ? end - start + 1 : 0,
    text,
  };
}

export default function register(api: OpenClawPluginApi) {
  api.registerTool({
    name: "memory_munch_path_root",
    description: "List top-level Memory-Munch paths for deterministic navigation.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute() {
      return asToolResponse(await runBridge(api, ["path_root"]));
    },
  });

  api.registerTool({
    name: "memory_munch_path_children",
    description: "List child lookup paths under a parent path.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string" },
        limit: { type: "number" },
        cursor: { type: "string" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const path = typeof params.path === "string" ? params.path : "";
      const limit = typeof params.limit === "number" ? String(Math.trunc(params.limit)) : "100";
      const cursor = typeof params.cursor === "string" ? params.cursor : "";
      const args = ["path_children", "--path", path, "--limit", limit];
      if (cursor) args.push("--cursor", cursor);
      return asToolResponse(await runBridge(api, args));
    },
  });

  api.registerTool({
    name: "memory_munch_path_lookup",
    description: "Deterministic retrieval by lookup path.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string" },
        max_tokens: { type: "number" },
        limit: { type: "number" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const path = typeof params.path === "string" ? params.path : "";
      if (!path.trim()) throw new Error("path is required");
      const maxTokens =
        typeof params.max_tokens === "number" ? String(Math.trunc(params.max_tokens)) : "2400";
      const limit = typeof params.limit === "number" ? String(Math.trunc(params.limit)) : "20";
      return asToolResponse(
        await runBridge(api, [
          "path_lookup",
          "--path",
          path,
          "--max_tokens",
          maxTokens,
          "--limit",
          limit,
        ]),
      );
    },
  });

  api.registerTool((ctx) => ({
    name: "memory_munch_text_search",
    description: "Keyword search over Memory-Munch chunks (FTS).",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        path_prefix: { type: "string" },
        max_tokens: { type: "number" },
        limit: { type: "number" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query : "";
      if (!query.trim()) throw new Error("query is required");
      const pathPrefix = typeof params.path_prefix === "string" ? params.path_prefix : "";
      const maxTokens =
        typeof params.max_tokens === "number" ? String(Math.trunc(params.max_tokens)) : "2400";
      const limitNum = typeof params.limit === "number" ? Math.trunc(params.limit) : 20;
      const limit = String(limitNum);
      const args = [
        "text_search",
        "--query",
        query,
        "--max_tokens",
        maxTokens,
        "--limit",
        limit,
      ];
      if (pathPrefix) args.push("--path_prefix", pathPrefix);
      const payload = (await runBridge(api, args)) as { data?: { items?: unknown[] } };
      const items = Array.isArray(payload?.data?.items) ? payload.data.items : [];
      if (payload?.data && Array.isArray(payload.data.items)) {
        payload.data.items = rerankItemsForQuery(items, query, limitNum).map(stripSourceFields);
      }
      // Fallback to OpenClaw native vector search when FTS finds nothing.
      if (!payload?.data?.items?.length) {
        const nativeTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        if (nativeTool) {
          return await nativeTool.execute(_id, { query, maxResults: limitNum });
        }
      }
      return asToolResponse(payload);
    },
  }));

  // Compatibility alias: models that naturally reach for `memory_search`
  // can still be routed through Memory-Munch without native memory_search.
  api.registerTool((ctx) => ({
    name: "memory_search",
    description: "Memory search compatibility alias backed by Memory-Munch FTS.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string" },
        maxResults: { type: "number" },
        minScore: { type: "number" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query : "";
      if (!query.trim()) throw new Error("query is required");
      const maxResultsNum =
        typeof params.maxResults === "number" ? Math.max(1, Math.trunc(params.maxResults)) : 5;
      const payload = await runBridge(api, [
        "text_search",
        "--query",
        query,
        "--max_tokens",
        "1200",
        "--limit",
        String(Math.max(maxResultsNum, 8)),
      ]);
      const p = payload as { data?: { items?: unknown[] } };
      const items = Array.isArray(p?.data?.items) ? p.data.items : [];
      if (p?.data && Array.isArray(p.data.items)) {
        p.data.items = rerankItemsForQuery(items, query, maxResultsNum).map(stripSourceFields);
      }
      // Fallback to OpenClaw native vector search when FTS finds nothing.
      if (!items.length) {
        const nativeTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        if (nativeTool) {
          return await nativeTool.execute(_id, { query, maxResults: maxResultsNum });
        }
      }
      return asToolResponse(asLegacyMemorySearch(p));
    },
  }));

  // Compatibility alias matching OpenClaw core memory_get schema.
  api.registerTool({
    name: "memory_get",
    description: "Read a bounded line-range snippet from memory files.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string" },
        from: { type: "number" },
        lines: { type: "number" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      return asToolResponse(await runMemoryGetFromFile(api, params));
    },
  });

  api.registerTool({
    name: "memory_munch_chunk_fetch",
    description: "Fetch a full memory chunk by chunk_id.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["chunk_id"],
      properties: {
        chunk_id: { type: "number" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const chunkId = typeof params.chunk_id === "number" ? Math.trunc(params.chunk_id) : NaN;
      if (!Number.isFinite(chunkId)) throw new Error("chunk_id is required");
      return asToolResponse(await runBridge(api, ["chunk_fetch", "--chunk_id", String(chunkId)]));
    },
  });
}

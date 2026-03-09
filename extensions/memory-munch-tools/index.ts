import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { MemoryMunchClient, resolvePluginCfg } from "./sdk/client";
import { readMemoryFileSnippet } from "./sdk/files";
import { MemoryMunchModelApi, toLegacyMemorySearch } from "./sdk/model";
import { MemoryMunchRawApi } from "./sdk/raw";

// tryNativeFallback uses api.runtime.tools.createMemorySearchTool, which is not in the
// documented plugin API. It is intentional: when FTS finds nothing, we attempt to
// delegate to OpenClaw's displaced native vector search rather than returning empty.
// This may break on OpenClaw upgrades. Track: https://github.com/dottedt/memory-munch/issues/1
async function tryNativeFallback(
  api: OpenClawPluginApi,
  ctx: { config: unknown; sessionKey: string | undefined },
  id: string,
  query: string,
  maxResults: number,
): Promise<unknown | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nativeTool = (api.runtime.tools as any).createMemorySearchTool?.({
    config: ctx.config,
    agentSessionKey: ctx.sessionKey,
  });
  if (!nativeTool) return null;
  try {
    return await nativeTool.execute(id, { query, maxResults });
  } catch {
    return null;
  }
}

function asToolResponse(payload: unknown) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: { json: payload },
  };
}

function formatSavings(data: Record<string, unknown>): string {
  const total = typeof data.total_tokens_saved === "number" ? data.total_tokens_saved : 0;
  const totalCost = data.total_cost_avoided as Record<string, number> | undefined;
  const parts = [`Memory-Munch: ${total.toLocaleString()} tokens saved`];
  if (totalCost) {
    const entries = Object.entries(totalCost)
      .map(([k, v]) => `${k}: $${v.toFixed(4)}`)
      .join(", ");
    if (entries) parts.push(`(${entries} avoided)`);
  }
  return parts.join(" ");
}

export default function register(api: OpenClawPluginApi) {
  const cfg = resolvePluginCfg(api);
  const client = new MemoryMunchClient(cfg);
  const raw = new MemoryMunchRawApi(client);
  const memory = new MemoryMunchModelApi(raw);
  let watchProc: ChildProcessWithoutNullStreams | null = null;

  if (cfg.autoInjectPromptContext) {
    api.on("before_prompt_build", async (event, ctx) => {
      if (ctx.trigger && ctx.trigger !== "user") return;
      const query = event.prompt?.trim();
      if (!query || query.length < 4) return;
      try {
        const context = await memory.buildPromptContext(query);
        if (!context) return;
        return { prependContext: context };
      } catch {
        return;
      }
    });
  }

  api.registerCommand({
    name: "savings",
    description: "Show Memory-Munch token savings and estimated cost avoided.",
    async handler() {
      try {
        const result = (await raw.savings()) as { data?: Record<string, unknown> };
        return { text: formatSavings(result?.data ?? {}) };
      } catch (e) {
        return { text: `Memory-Munch savings unavailable: ${String(e)}` };
      }
    },
  });

  // Primary model-facing API
  api.registerTool(
    (ctx) => ({
      name: "memory_search",
      description: "Search memory using deterministic keyword and path retrieval, with native vector fallback.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
      },
      async execute(id: string, params: Record<string, unknown>) {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) throw new Error("query is required");
        const maxResults =
          typeof params.maxResults === "number" ? Math.max(1, Math.trunc(params.maxResults)) : 5;
        const result = await memory.findRelevant({ query, maxResults });
        if (!result.items.length) {
          const fallback = await tryNativeFallback(api, ctx, id, query, maxResults);
          if (fallback !== null) return fallback;
        }
        return asToolResponse(toLegacyMemorySearch(result.items));
      },
    }),
  );

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
      const path = typeof params.path === "string" ? params.path : "";
      return asToolResponse(
        await readMemoryFileSnippet(cfg, {
          path,
          from: typeof params.from === "number" ? params.from : undefined,
          lines: typeof params.lines === "number" ? params.lines : undefined,
        }),
      );
    },
  });

  api.registerTool(
    {
      name: "memory_lookup",
      description: "High-level memory lookup (path-first when query looks like a lookup path).",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
          pathPrefix: { type: "string" },
        },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) throw new Error("query is required");
        const maxResults =
          typeof params.maxResults === "number" ? Math.max(1, Math.trunc(params.maxResults)) : 5;
        const pathPrefix = typeof params.pathPrefix === "string" ? params.pathPrefix.trim() : "";
        const result = await memory.findRelevant({
          query,
          maxResults,
          pathPrefix: pathPrefix || undefined,
        });
        return asToolResponse({
          strategy: result.strategy,
          items: result.items,
        });
      },
    },
    { optional: true },
  );

  if (cfg.exposeRawTools) {
    // Low-level compatibility plumbing, hidden by default.
    api.registerTool({
      name: "memory_munch_path_root",
      description: "Low-level: list top-level Memory-Munch paths.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
      async execute() {
        return asToolResponse(await raw.pathRoot());
      },
    });

    api.registerTool({
      name: "memory_munch_path_children",
      description: "Low-level: list child lookup paths under a parent path.",
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
        return asToolResponse(
          await raw.pathChildren({
            path: typeof params.path === "string" ? params.path : "",
            limit: typeof params.limit === "number" ? params.limit : undefined,
            cursor: typeof params.cursor === "string" ? params.cursor : undefined,
          }),
        );
      },
    });

    api.registerTool({
      name: "memory_munch_path_lookup",
      description: "Low-level: deterministic retrieval by lookup path.",
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
        const path = typeof params.path === "string" ? params.path.trim() : "";
        if (!path) throw new Error("path is required");
        return asToolResponse(
          await raw.pathLookup({
            path,
            maxTokens: typeof params.max_tokens === "number" ? params.max_tokens : undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          }),
        );
      },
    });

    api.registerTool({
      name: "memory_munch_text_search",
      description: "Low-level: keyword search over Memory-Munch chunks.",
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
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) throw new Error("query is required");
        return asToolResponse(
          await raw.textSearch({
            query,
            pathPrefix: typeof params.path_prefix === "string" ? params.path_prefix : undefined,
            maxTokens: typeof params.max_tokens === "number" ? params.max_tokens : undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          }),
        );
      },
    });

    api.registerTool({
      name: "memory_munch_chunk_fetch",
      description: "Low-level: fetch a full memory chunk by chunk_id.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["chunk_id"],
        properties: { chunk_id: { type: "number" } },
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const chunkId = typeof params.chunk_id === "number" ? Math.trunc(params.chunk_id) : NaN;
        if (!Number.isFinite(chunkId)) throw new Error("chunk_id is required");
        return asToolResponse(await raw.chunkFetch(chunkId));
      },
    });
  }

  api.registerService({
    id: "memory-munch-watch",
    start: async () => {
      if (!cfg.autoIndexWatch) {
        api.logger.info("memory-munch: auto index watch disabled");
        return;
      }
      if (watchProc) {
        return;
      }

      const args = [
        "-m",
        "dmemorymunch_mpc.cli",
        "watch",
        "--config",
        cfg.configPath,
        "--interval",
        String(cfg.autoIndexWatchIntervalSec),
      ];
      watchProc = spawn(cfg.pythonBin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      watchProc.stdout.on("data", (d) => {
        const msg = String(d).trim();
        if (msg) api.logger.info(`memory-munch watch: ${msg}`);
      });
      watchProc.stderr.on("data", (d) => {
        const msg = String(d).trim();
        if (msg) api.logger.warn(`memory-munch watch stderr: ${msg}`);
      });
      watchProc.on("close", (code, signal) => {
        api.logger.warn(
          `memory-munch watch exited (code=${String(code)}, signal=${String(signal)})`,
        );
        watchProc = null;
      });
      watchProc.on("error", (e) => {
        api.logger.error(`memory-munch watch failed: ${String(e)}`);
      });

      api.logger.info(
        `memory-munch: auto index watch started (interval=${cfg.autoIndexWatchIntervalSec}s)`,
      );
    },
    stop: async () => {
      if (!watchProc) return;
      const proc = watchProc;
      watchProc = null;

      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        proc.once("close", () => done());
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (settled) return;
          proc.kill("SIGKILL");
          done();
        }, 2000);
      });

      api.logger.info("memory-munch: auto index watch stopped");
    },
  });
}

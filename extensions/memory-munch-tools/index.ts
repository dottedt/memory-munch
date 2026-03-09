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
  let nodeWatchTimer: NodeJS.Timeout | null = null;

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

  if (cfg.autoFlushOnCompaction) {
    api.on("before_compaction", async (event) => {
      const text = String((event as { context?: string })?.context ?? "");
      if (text.length < 100) return;
      try {
        await raw.memorySave({
          content: text,
          path: `session_log.${Date.now()}`,
          heading: "Session snapshot",
          replace: false,
        });
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

  api.registerTool({
    name: "memory_save",
    description: "Persist memory directly to the local memory index.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["content"],
      properties: {
        content: { type: "string" },
        path: { type: "string" },
        heading: { type: "string" },
        replace: { type: "boolean" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const content = typeof params.content === "string" ? params.content : "";
      if (!content.trim()) throw new Error("content is required");
      return asToolResponse(
        await raw.memorySave({
          content,
          path: typeof params.path === "string" ? params.path : undefined,
          heading: typeof params.heading === "string" ? params.heading : undefined,
          replace: typeof params.replace === "boolean" ? params.replace : false,
        }),
      );
    },
  });

  api.registerTool({
    name: "memory_relate",
    description: "Create a relationship edge between memory lookup paths.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["subject", "predicate", "object"],
      properties: {
        subject: { type: "string" },
        predicate: { type: "string" },
        object: { type: "string" },
      },
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const subject = typeof params.subject === "string" ? params.subject.trim() : "";
      const predicate = typeof params.predicate === "string" ? params.predicate.trim() : "";
      const object = typeof params.object === "string" ? params.object.trim() : "";
      if (!subject || !predicate || !object) {
        throw new Error("subject, predicate, and object are required");
      }
      return asToolResponse(await raw.memoryRelate({ subject, predicate, object }));
    },
  });

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
      if (nodeWatchTimer) return;
      try {
        await client.call(["index", "--scope", "changed"]);
      } catch (e) {
        api.logger.warn(`memory-munch index failed: ${String(e)}`);
      }
      nodeWatchTimer = setInterval(async () => {
        try {
          await client.call(["index", "--scope", "changed"]);
        } catch (e) {
          api.logger.warn(`memory-munch index failed: ${String(e)}`);
        }
      }, Math.max(500, Math.floor(cfg.autoIndexWatchIntervalSec * 1000)));
      api.logger.info(
        `memory-munch: node auto index watch started (interval=${cfg.autoIndexWatchIntervalSec}s)`,
      );
    },
    stop: async () => {
      if (nodeWatchTimer) {
        clearInterval(nodeWatchTimer);
        nodeWatchTimer = null;
        client.close();
        api.logger.info("memory-munch: node auto index watch stopped");
      }
    },
  });
}

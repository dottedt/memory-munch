import { NodeMemoryMunchBackend } from "./node_backend";

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export class NodeBridge {
  private readonly backend: NodeMemoryMunchBackend;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(configPath: string) {
    this.backend = new NodeMemoryMunchBackend(configPath);
  }

  close(): void {
    this.backend.close();
  }

  private async callInternal(args: string[]): Promise<unknown> {
    const op = (args[0] || "").trim();
    switch (op) {
      case "path_root":
        return this.backend.pathRoot();
      case "path_children": {
        const path = readFlag(args, "--path") || "";
        const limit = Number(readFlag(args, "--limit") || "100");
        const cursor = readFlag(args, "--cursor");
        return this.backend.pathChildren(path, Number.isFinite(limit) ? limit : 100, cursor);
      }
      case "path_lookup": {
        const path = readFlag(args, "--path") || "";
        const maxTokens = Number(readFlag(args, "--max_tokens") || "2400");
        const limit = Number(readFlag(args, "--limit") || "20");
        return this.backend.pathLookup(path, Number.isFinite(maxTokens) ? maxTokens : 2400, Number.isFinite(limit) ? limit : 20);
      }
      case "text_search": {
        const query = readFlag(args, "--query") || "";
        const pathPrefix = readFlag(args, "--path_prefix");
        const maxTokens = Number(readFlag(args, "--max_tokens") || "2400");
        const limit = Number(readFlag(args, "--limit") || "20");
        return this.backend.textSearch(
          query,
          pathPrefix,
          Number.isFinite(maxTokens) ? maxTokens : 2400,
          Number.isFinite(limit) ? limit : 20,
        );
      }
      case "chunk_fetch": {
        const id = Number(readFlag(args, "--chunk_id") || "-1");
        return this.backend.chunkFetch(Number.isFinite(id) ? id : -1);
      }
      case "memory_save": {
        const content = readFlag(args, "--content") || "";
        const path = readFlag(args, "--path");
        const heading = readFlag(args, "--heading");
        const replaceRaw = (readFlag(args, "--replace") || "").toLowerCase();
        const replace = replaceRaw === "true" || replaceRaw === "1" || replaceRaw === "yes";
        return this.backend.saveDirectChunk({ content, path, heading, replace });
      }
      case "memory_relate": {
        const subject = readFlag(args, "--subject") || "";
        const predicate = readFlag(args, "--predicate") || "";
        const object = readFlag(args, "--object") || "";
        return this.backend.relate({ subject, predicate, object });
      }
      case "savings":
        return this.backend.savings();
      case "index": {
        const scope = readFlag(args, "--scope");
        return this.backend.index(scope === "all" ? "all" : "changed");
      }
      default:
        return {
          ok: false,
          api_version: "v2",
          data: null,
          error: { code: "INVALID_OPERATION", message: `Unknown operation: ${op}`, details: {} },
        };
    }
  }

  async call(args: string[]): Promise<unknown> {
    // Serialize access to the single DatabaseSync connection to avoid
    // overlapping operations (watch indexing vs tool calls).
    const run = this.queue.then(() => this.callInternal(args));
    this.queue = run.catch(() => undefined);
    return await run;
  }

  async reindex(scope: "all" | "changed" = "changed") {
    return this.backend.index(scope);
  }
}

import { NodeMemoryMunchBackend } from "./node_backend";

function readFlag(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

export class NodeBridge {
  private readonly backend: NodeMemoryMunchBackend;

  constructor(configPath: string) {
    this.backend = new NodeMemoryMunchBackend(configPath);
  }

  close(): void {
    this.backend.close();
  }

  async call(args: string[]): Promise<unknown> {
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
      case "savings":
        return this.backend.savings();
      case "index": {
        const scope = readFlag(args, "--scope");
        return { ok: true, api_version: "v2", data: await this.backend.index(scope === "all" ? "all" : "changed"), error: null };
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

  async reindex(scope: "all" | "changed" = "changed"): Promise<Record<string, unknown>> {
    return await this.backend.index(scope);
  }
}

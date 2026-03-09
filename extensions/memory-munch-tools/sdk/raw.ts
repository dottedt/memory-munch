import { MemoryMunchClient } from "./client";

export class MemoryMunchRawApi {
  constructor(private readonly client: MemoryMunchClient) {}

  pathRoot() {
    return this.client.call(["path_root"]);
  }

  pathChildren(params: { path?: string; limit?: number; cursor?: string }) {
    const path = params.path ?? "";
    const limit = String(Math.max(1, Math.trunc(params.limit ?? 100)));
    const args = ["path_children", "--path", path, "--limit", limit];
    if (params.cursor?.trim()) args.push("--cursor", params.cursor.trim());
    return this.client.call(args);
  }

  pathLookup(params: { path: string; maxTokens?: number; limit?: number }) {
    const args = [
      "path_lookup",
      "--path",
      params.path,
      "--max_tokens",
      String(Math.max(1, Math.trunc(params.maxTokens ?? 2400))),
      "--limit",
      String(Math.max(1, Math.trunc(params.limit ?? 20))),
    ];
    return this.client.call(args);
  }

  textSearch(params: { query: string; pathPrefix?: string; maxTokens?: number; limit?: number }) {
    const args = [
      "text_search",
      "--query",
      params.query,
      "--max_tokens",
      String(Math.max(1, Math.trunc(params.maxTokens ?? 2400))),
      "--limit",
      String(Math.max(1, Math.trunc(params.limit ?? 20))),
    ];
    if (params.pathPrefix?.trim()) args.push("--path_prefix", params.pathPrefix.trim());
    return this.client.call(args);
  }

  chunkFetch(chunkId: number) {
    return this.client.call(["chunk_fetch", "--chunk_id", String(Math.trunc(chunkId))]);
  }

  savings() {
    return this.client.call(["savings"]);
  }
}

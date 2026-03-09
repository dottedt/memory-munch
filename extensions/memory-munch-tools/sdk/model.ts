import { MemoryMunchRawApi } from "./raw";

type SearchItem = Record<string, unknown>;

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

function rerank(items: SearchItem[], query: string, maxResults: number): SearchItem[] {
  const qTokens = queryTokens(query);
  if (qTokens.length === 0) return items.slice(0, maxResults);
  const scored = items
    .map((row) => {
      const snippet = String(row.snippet ?? "");
      const lookupPath = String(row.lookup_path ?? "");
      const hay = `${snippet} ${lookupPath}`.toLowerCase();
      let overlap = 0;
      for (const tok of qTokens) {
        if (hay.includes(tok)) overlap += 1;
      }
      const ratio = overlap / qTokens.length;
      const baseScore = typeof row.score === "number" ? row.score : 0;
      return { row, score: baseScore + ratio * 10 };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, maxResults).map((x) => x.row);
}

function stripInternalFields(item: SearchItem): SearchItem {
  const row = { ...item };
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

function isLikelyLookupPath(query: string): boolean {
  return /^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/i.test(query.trim());
}

function itemsFromPayload(payload: unknown): SearchItem[] {
  const p = payload as { data?: { items?: SearchItem[] } };
  return Array.isArray(p?.data?.items) ? p.data.items : [];
}

export class MemoryMunchModelApi {
  constructor(private readonly raw: MemoryMunchRawApi) {}

  /**
   * Composed retrieval helper:
   * - path lookup first when query looks like a deterministic lookup path
   * - then text search
   */
  async findRelevant(params: { query: string; maxResults?: number; pathPrefix?: string }) {
    const query = params.query.trim();
    if (!query) throw new Error("query is required");
    const maxResults = Math.max(1, Math.trunc(params.maxResults ?? 5));

    let strategy: "path_lookup" | "text_search" = "text_search";
    let payload: unknown;
    if (isLikelyLookupPath(query)) {
      strategy = "path_lookup";
      payload = await this.raw.pathLookup({ path: query, maxTokens: 1200, limit: maxResults });
    } else {
      payload = await this.raw.textSearch({
        query,
        pathPrefix: params.pathPrefix,
        maxTokens: 1200,
        limit: Math.max(maxResults, 8),
      });
    }

    const items = itemsFromPayload(payload);
    const normalized = rerank(items, query, maxResults).map(stripInternalFields);
    return { strategy, items: normalized, payload };
  }

  /**
   * Prompt helper for optional before_prompt_build enrichment.
   */
  async buildPromptContext(query: string): Promise<string | null> {
    const payload = await this.raw.textSearch({
      query,
      maxTokens: 1200,
      limit: 6,
    });
    const items = itemsFromPayload(payload);
    if (!items.length) return null;
    const snippets = items
      .map((item) => String(item.snippet ?? "").trim())
      .filter((s) => {
        if (!s) return false;
        const lines = s.split("\n").filter((l) => l.trim());
        if (!lines.length) return false;
        const boilerplate = lines.every((l) => /^Profile note \d+:/i.test(l.trim()));
        return !boilerplate;
      })
      .join("\n\n---\n\n");
    if (!snippets) return null;
    return `[Memory context]\n${snippets}\n[End memory context]`;
  }
}

export function toLegacyMemorySearch(items: SearchItem[]) {
  return {
    results: items,
    provider: "memory-munch",
    model: "sqlite-fts5",
    fallback: false,
    citations: "off",
    mode: "memory-munch",
  };
}

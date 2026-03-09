import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildLookupPath, parentPath } from "./node_paths";
import { loadNodeBackendSettings, resolveDbPath, type NodeBackendSettings } from "./node_config";
import { parseMarkdownBlocks } from "./node_parser";

type TraceStep = { stage: string; detail: string };

type EnvelopeOk = {
  ok: true;
  api_version: "v2";
  data: Record<string, unknown>;
  error: null;
  _meta: Record<string, unknown>;
};

type EnvelopeErr = {
  ok: false;
  api_version: "v2";
  data: null;
  error: { code: string; message: string; details: Record<string, unknown> };
  _meta: Record<string, unknown>;
};

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "asked",
  "at",
  "be",
  "by",
  "did",
  "do",
  "does",
  "for",
  "from",
  "give",
  "given",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "them",
  "they",
  "this",
  "to",
  "up",
  "us",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
]);

const PRICING: Record<string, number> = {
  claude_opus: 5.0 / 1_000_000,
  gpt5_latest: 1.75 / 1_000_000,
};

const FACT_PREDICATE_SYNONYMS: Record<string, string[]> = {
  phone: ["phone", "telephone", "mobile", "cell", "number"],
  email: ["email", "e-mail", "mail"],
  ssid: ["ssid", "wifi", "wi-fi", "wireless"],
  follow_up_preference: ["follow-up", "followup", "follow", "preference", "availability"],
  company: ["company", "organization", "org"],
  title: ["title", "role", "position"],
};

const UNICODE_REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "—": "-",
  "–": "-",
  "“": '"',
  "”": '"',
  "’": "'",
  "…": "...",
};

function utcIso(): string {
  return new Date().toISOString();
}

function safeText(text: string): string {
  let out = text;
  for (const [src, dst] of Object.entries(UNICODE_REPLACEMENTS)) {
    out = out.split(src).join(dst);
  }
  return out.normalize("NFKD");
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.floor((text.length + 3) / 4));
}

function bytesToTokens(n: number): number {
  return Math.max(0, Math.floor((n + 3) / 4));
}

function estimateSavings(rawBytes: number, responseBytes: number): number {
  return Math.max(0, Math.floor((rawBytes - responseBytes) / 4));
}

function _savingsPath(): string {
  const root = process.env.DMEMORYMUNCH_SAVINGS_PATH || path.join(process.env.HOME || ".", ".memorymunch");
  fs.mkdirSync(root, { recursive: true });
  return path.join(root, "_savings.json");
}

function readTotalSaved(): number {
  try {
    const p = _savingsPath();
    if (!fs.existsSync(p)) return 0;
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as { total_tokens_saved?: number };
    return Math.max(0, Math.trunc(raw.total_tokens_saved || 0));
  } catch {
    return 0;
  }
}

function recordSaved(delta: number): number {
  const total = readTotalSaved() + Math.max(0, Math.trunc(delta));
  try {
    fs.writeFileSync(_savingsPath(), JSON.stringify({ total_tokens_saved: total }), "utf-8");
  } catch {}
  return total;
}

function costAvoided(tokens: number, totalTokens: number): { cost_avoided: Record<string, number>; total_cost_avoided: Record<string, number> } {
  const cost_avoided: Record<string, number> = {};
  const total_cost_avoided: Record<string, number> = {};
  for (const [k, v] of Object.entries(PRICING)) {
    cost_avoided[k] = Number((tokens * v).toFixed(4));
    total_cost_avoided[k] = Number((totalTokens * v).toFixed(4));
  }
  return { cost_avoided, total_cost_avoided };
}

function collectFilePaths(value: unknown, out: Set<string>): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const x of value) collectFilePaths(x, out);
    return;
  }
  if (typeof value !== "object") return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (["file_path", "source_file", "path"].includes(k) && typeof v === "string") {
      out.add(v);
    } else {
      collectFilePaths(v, out);
    }
  }
}

function resolveSourcePath(filePath: string): string {
  if (filePath.startsWith("home/")) {
    return path.resolve(process.env.HOME || "", filePath.slice(5));
  }
  return path.resolve(process.cwd(), filePath);
}

function fileSizeSafe(filePath: string): number {
  try {
    return fs.statSync(resolveSourcePath(filePath)).size;
  } catch {
    return 0;
  }
}

function buildMeta(data: Record<string, unknown>, startedAtMs: number): Record<string, unknown> {
  const filePaths = new Set<string>();
  collectFilePaths(data, filePaths);
  let rawBytes = 0;
  for (const p of filePaths) rawBytes += fileSizeSafe(p);
  const responseBytes = Buffer.byteLength(JSON.stringify(data), "utf-8");
  const tokensSaved = estimateSavings(rawBytes, responseBytes);
  const total = recordSaved(tokensSaved);
  return {
    timing_ms: Number((Date.now() - startedAtMs).toFixed(2)),
    raw_bytes_estimate: rawBytes,
    response_bytes: responseBytes,
    raw_tokens_estimate: bytesToTokens(rawBytes),
    response_tokens_estimate: bytesToTokens(responseBytes),
    tokens_saved: tokensSaved,
    total_tokens_saved: total,
    ...costAvoided(tokensSaved, total),
  };
}

function ok(data: Record<string, unknown>, startedAtMs: number): EnvelopeOk {
  return { ok: true, api_version: "v2", data, error: null, _meta: buildMeta(data, startedAtMs) };
}

function err(code: string, message: string, details: Record<string, unknown>, startedAtMs: number): EnvelopeErr {
  return {
    ok: false,
    api_version: "v2",
    data: null,
    error: { code, message, details },
    _meta: { timing_ms: Number((Date.now() - startedAtMs).toFixed(2)) },
  };
}

type DiscoveredFile = { absPath: string; relPath: string };

type ChunkRecord = {
  lookupPath: string;
  parentPath: string | null;
  chunkOrder: number;
  content: string;
  tokenCount: number;
  sourceFile: string;
  startLine: number;
  endLine: number;
};

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLESTAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLESTAR::/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

function matchesAnyGlob(rel: string, globs: string[]): boolean {
  const base = path.basename(rel);
  for (const g of globs) {
    if (!g.includes("/") && globToRegExp(g).test(base)) return true;
    if (globToRegExp(g).test(rel)) return true;
    if (g.includes("/**/")) {
      const compact = g.replace("/**/", "/");
      if (globToRegExp(compact).test(rel)) return true;
    }
  }
  return false;
}

async function walkMarkdown(rootDir: string, out: string[]): Promise<void> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(rootDir, e.name);
    if (e.isDirectory()) {
      await walkMarkdown(p, out);
      continue;
    }
    if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      out.push(p);
    }
  }
}

function normalizeRelPath(absPath: string, cwd: string): string {
  const abs = path.resolve(absPath);
  const home = process.env.HOME ? path.resolve(process.env.HOME) : "";
  if (home && (abs === home || abs.startsWith(`${home}${path.sep}`))) {
    return `home/${path.relative(home, abs).replace(/\\/g, "/")}`;
  }
  const cwdAbs = path.resolve(cwd);
  if (abs === cwdAbs || abs.startsWith(`${cwdAbs}${path.sep}`)) {
    return path.relative(cwdAbs, abs).replace(/\\/g, "/");
  }
  return abs.replace(/\\/g, "/");
}

function tokenizeTerms(text: string): string[] {
  const out: string[] = [];
  const parts = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const p of parts) {
    if (p.length < 3 || STOPWORDS.has(p)) continue;
    out.push(p);
  }
  return out;
}

function safeTerm(raw: string): string | null {
  const s = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s.length >= 2 ? s : null;
}

function normalizePredicate(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function significantTerms(query: string): string[] {
  const terms = query.toLowerCase().match(/[a-z0-9_]+/g) || [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of terms) {
    if (t.length < 3 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function inferPredicates(query: string): string[] {
  const q = query.toLowerCase();
  const out: string[] = [];
  for (const [pred, words] of Object.entries(FACT_PREDICATE_SYNONYMS)) {
    if (words.some((w) => q.includes(w))) out.push(pred);
  }
  return out;
}

function extractSubjectTokens(query: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const phrases = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  for (const phrase of phrases.slice(0, 2)) {
    const terms = phrase.toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const t of terms) {
      if (t.length < 2 || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= 4) return out;
    }
  }
  return out;
}

function overlap(content: string, terms: string[]): number {
  if (!content || terms.length === 0) return 0;
  const low = content.toLowerCase();
  let hit = 0;
  for (const t of terms) if (low.includes(t)) hit += 1;
  return hit / terms.length;
}

function activation(row: Record<string, unknown>): number {
  const access = typeof row.access_count === "number" ? row.access_count : 0;
  const last = typeof row.last_accessed === "string" ? row.last_accessed : "";
  let recency = 0;
  if (last) {
    const ts = Date.parse(last);
    if (Number.isFinite(ts)) {
      const days = Math.max(0, (Date.now() - ts) / 86400000);
      recency = 1 / (days + 1);
    }
  }
  return recency + Math.log1p(Math.max(0, access));
}

function queryVariants(query: string): Array<{ label: string; q: string }> {
  const allTerms = query.toLowerCase().match(/[a-z0-9_]+/g) || [];
  const sig = significantTerms(query);
  const variants: Array<{ label: string; q: string }> = [];
  const seen = new Set<string>();

  const add = (label: string, q: string) => {
    const key = `${label}:${q}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ label, q });
  };

  if (allTerms.length) add("fts_exact", allTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(" "));
  if (sig.length && sig.join(" ") !== allTerms.join(" ")) {
    add("fts_keywords", sig.slice(0, 8).map((t) => `"${t.replace(/"/g, '""')}"`).join(" "));
  }
  if (sig.length > 1) {
    add("fts_or", sig.slice(0, 8).map((t) => `"${t.replace(/"/g, '""')}"`).join(" OR "));
  }

  const names = query.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  for (const phrase of names.slice(0, 2)) {
    const ts = phrase.toLowerCase().match(/[a-z0-9_]+/g) || [];
    if (ts.length) add("fts_name", ts.map((t) => `"${t.replace(/"/g, '""')}"`).join(" "));
  }

  return variants;
}

function rowToHit(row: Record<string, unknown>, score: number, snippetChars: number): Record<string, unknown> {
  const content = String(row.content || "");
  const ftsSnippet = typeof row.fts_snippet === "string" ? row.fts_snippet.trim() : "";
  return {
    path: row.source_file,
    startLine: row.start_line,
    endLine: row.end_line,
    snippet: ftsSnippet || content.slice(0, snippetChars),
    score: Number(score.toFixed(4)),
    chunk_id: row.chunk_id,
    lookup_path: row.lookup_path,
    token_count: row.token_count,
    chunk_order: row.chunk_order,
  };
}

function applyTokenBudget(hits: Record<string, unknown>[], maxTokens: number): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let used = 0;
  for (const h of hits) {
    const t = typeof h.token_count === "number" ? h.token_count : 0;
    if (used + t > maxTokens) break;
    out.push(h);
    used += t;
  }
  return out;
}

function segmentLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const out: string[] = [];
  for (let i = 0; i < line.length; i += maxChars) out.push(line.slice(i, i + maxChars));
  return out.length ? out : [""];
}

function chunkBlocks(sourceFile: string, blocks: ReturnType<typeof parseMarkdownBlocks>): ChunkRecord[] {
  const out: ChunkRecord[] = [];
  const orderByPath = new Map<string, number>();

  let pendingTexts: string[] = [];
  let pendingStart: number | null = null;
  let pendingEnd: number | null = null;
  let pendingTokens = 0;
  let pendingLookup: string | null = null;

  const flush = () => {
    if (!pendingTexts.length || pendingLookup === null || pendingStart === null || pendingEnd === null) {
      pendingTexts = [];
      pendingStart = null;
      pendingEnd = null;
      pendingTokens = 0;
      pendingLookup = null;
      return;
    }
    const content = pendingTexts.join("\n\n").trim();
    const order = orderByPath.get(pendingLookup) || 0;
    out.push({
      lookupPath: pendingLookup,
      parentPath: parentPath(pendingLookup),
      chunkOrder: order,
      content,
      tokenCount: estimateTokens(content),
      sourceFile,
      startLine: pendingStart,
      endLine: pendingEnd,
    });
    orderByPath.set(pendingLookup, order + 1);
    pendingTexts = [];
    pendingStart = null;
    pendingEnd = null;
    pendingTokens = 0;
    pendingLookup = null;
  };

  const targetMinTokens = 100;
  const targetMaxTokens = 300;
  const maxChars = targetMaxTokens * 4;

  for (const b of blocks) {
    const lookup = buildLookupPath(sourceFile, b.headingChain);
    const blockText = safeText(b.text).trim();
    if (!blockText) continue;

    const lines = blockText.split("\n");
    const segments: Array<{ text: string; start: number; end: number }> = [];

    let curLines: string[] = [];
    let curChars = 0;
    let segStart: number | null = null;
    let segEnd: number | null = null;

    const flushSeg = () => {
      if (!curLines.length || segStart === null || segEnd === null) {
        curLines = [];
        curChars = 0;
        segStart = null;
        segEnd = null;
        return;
      }
      const t = curLines.join("\n").trim();
      if (t) segments.push({ text: t, start: segStart, end: segEnd });
      curLines = [];
      curChars = 0;
      segStart = null;
      segEnd = null;
    };

    for (let i = 0; i < lines.length; i += 1) {
      const lineNo = b.startLine + i;
      for (const piece of segmentLine(lines[i] || "", maxChars)) {
        const pieceSize = piece.length + 1;
        if (curLines.length > 0 && curChars + pieceSize > maxChars) flushSeg();
        if (segStart === null) segStart = lineNo;
        segEnd = lineNo;
        curLines.push(piece);
        curChars += pieceSize;
      }
    }
    flushSeg();

    for (const seg of segments) {
      const blockTokens = estimateTokens(seg.text);

      if (pendingLookup === null) {
        pendingLookup = lookup;
        pendingStart = seg.start;
      }

      if (pendingLookup !== lookup) {
        flush();
        pendingLookup = lookup;
        pendingStart = seg.start;
      }

      if (blockTokens >= targetMaxTokens) {
        flush();
        const order = orderByPath.get(lookup) || 0;
        out.push({
          lookupPath: lookup,
          parentPath: parentPath(lookup),
          chunkOrder: order,
          content: seg.text,
          tokenCount: blockTokens,
          sourceFile,
          startLine: seg.start,
          endLine: seg.end,
        });
        orderByPath.set(lookup, order + 1);
        continue;
      }

      if (pendingTokens >= targetMinTokens && pendingTokens + blockTokens > targetMaxTokens) {
        flush();
        pendingLookup = lookup;
        pendingStart = seg.start;
      }

      pendingTexts.push(seg.text);
      pendingTokens += blockTokens;
      pendingEnd = seg.end;
    }
  }

  flush();
  return out;
}

export class NodeMemoryMunchBackend {
  private readonly settings: NodeBackendSettings;
  private readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(private readonly configPath: string) {
    this.settings = loadNodeBackendSettings(configPath);
    this.dbPath = resolveDbPath(configPath, this.settings.dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA temp_store = MEMORY");
    this.db.exec("PRAGMA cache_size = -131072");
    this.db.exec("PRAGMA mmap_size = 268435456");
    this.db.exec("PRAGMA journal_size_limit = 67108864");
    this.ensureSchema();
  }

  close(): void {
    this.db.close();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  private ensureSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_manifest (
        file_path TEXT PRIMARY KEY,
        file_hash TEXT NOT NULL,
        mtime_ns INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_indexed_at TEXT NOT NULL,
        root_kind TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS index_runs (
        id INTEGER PRIMARY KEY,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        scope TEXT NOT NULL,
        files_scanned INTEGER NOT NULL,
        files_changed INTEGER NOT NULL,
        nodes_upserted INTEGER NOT NULL,
        nodes_deleted INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_summary TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_chunks (
        chunk_id INTEGER PRIMARY KEY,
        lookup_path TEXT NOT NULL,
        parent_path TEXT,
        chunk_order INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        source_file TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_lookup_path ON memory_chunks(lookup_path);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_parent_path ON memory_chunks(parent_path);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_lookup_order ON memory_chunks(lookup_path, chunk_order);
      CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_file ON memory_chunks(source_file);

      CREATE TABLE IF NOT EXISTS memory_lookup_paths (
        lookup_path TEXT PRIMARY KEY,
        parent_path TEXT,
        depth INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        child_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_lookup_paths_parent ON memory_lookup_paths(parent_path);
      CREATE INDEX IF NOT EXISTS idx_lookup_paths_depth ON memory_lookup_paths(depth);

      CREATE TABLE IF NOT EXISTS memory_terms (
        term TEXT NOT NULL,
        lookup_path TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY(term, lookup_path)
      );
      CREATE INDEX IF NOT EXISTS idx_memory_terms_lookup_path ON memory_terms(lookup_path);
      CREATE INDEX IF NOT EXISTS idx_memory_terms_term ON memory_terms(term);

      CREATE TABLE IF NOT EXISTS memory_index (
        chunk_id INTEGER PRIMARY KEY,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed TEXT,
        FOREIGN KEY(chunk_id) REFERENCES memory_chunks(chunk_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS memory_facts (
        fact_id INTEGER PRIMARY KEY,
        chunk_id INTEGER NOT NULL,
        lookup_path TEXT NOT NULL,
        subject TEXT,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        FOREIGN KEY(chunk_id) REFERENCES memory_chunks(chunk_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_facts_chunk ON memory_facts(chunk_id);
      CREATE INDEX IF NOT EXISTS idx_memory_facts_lookup_path ON memory_facts(lookup_path);
      CREATE INDEX IF NOT EXISTS idx_memory_facts_predicate ON memory_facts(predicate);
      CREATE INDEX IF NOT EXISTS idx_memory_facts_subject ON memory_facts(subject);

      DROP TRIGGER IF EXISTS memory_chunks_ai;
      DROP TRIGGER IF EXISTS memory_chunks_ad;
      DROP TRIGGER IF EXISTS memory_chunks_au;
      DROP TABLE IF EXISTS memory_fts;
    `);

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        content,
        lookup_path UNINDEXED,
        content='memory_chunks',
        content_rowid='chunk_id'
      );
      INSERT INTO memory_fts(memory_fts) VALUES ('rebuild');
      CREATE TRIGGER IF NOT EXISTS memory_chunks_ai AFTER INSERT ON memory_chunks BEGIN
        INSERT INTO memory_fts(rowid, content, lookup_path)
        VALUES (new.chunk_id, new.content, new.lookup_path);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_ad AFTER DELETE ON memory_chunks BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content, lookup_path)
        VALUES ('delete', old.chunk_id, old.content, old.lookup_path);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_chunks_au AFTER UPDATE ON memory_chunks BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content, lookup_path)
        VALUES ('delete', old.chunk_id, old.content, old.lookup_path);
        INSERT INTO memory_fts(rowid, content, lookup_path)
        VALUES (new.chunk_id, new.content, new.lookup_path);
      END;
    `);
  }

  async discoverFiles(cwd = process.cwd()): Promise<DiscoveredFile[]> {
    const files: DiscoveredFile[] = [];
    const seen = new Set<string>();

    for (const root of this.settings.roots) {
      const rootAbs = path.resolve(root);
      if (!fs.existsSync(rootAbs)) continue;

      const candidates: string[] = [];
      const memoryMd = path.join(rootAbs, "MEMORY.md");
      if (fs.existsSync(memoryMd)) candidates.push(memoryMd);
      const memoryDir = path.join(rootAbs, "memory");
      if (fs.existsSync(memoryDir) && fs.statSync(memoryDir).isDirectory()) {
        await walkMarkdown(memoryDir, candidates);
      }
      await walkMarkdown(rootAbs, candidates);

      for (const candidate of candidates) {
        let st: fs.Stats;
        try {
          st = fs.lstatSync(candidate);
        } catch {
          continue;
        }
        if (!st.isFile()) continue;
        if (st.isSymbolicLink() && !this.settings.followSymlinks) continue;

        const rel = normalizeRelPath(candidate, cwd);
        const relFromRoot = path.relative(rootAbs, candidate).replace(/\\/g, "/");
        if (this.settings.includeGlobs.length > 0 && !matchesAnyGlob(relFromRoot, this.settings.includeGlobs)) continue;
        if (matchesAnyGlob(relFromRoot, this.settings.excludeGlobs)) continue;

        const key = path.resolve(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        files.push({ absPath: candidate, relPath: rel });
      }
    }

    files.sort((a, b) => a.relPath.localeCompare(b.relPath));
    return files;
  }

  private hashFile(filePath: string): string {
    const h = createHash("sha256");
    const data = fs.readFileSync(filePath);
    h.update(data);
    return h.digest("hex");
  }

  private getManifest(): Map<string, Record<string, unknown>> {
    const rows = this.db.prepare("SELECT * FROM file_manifest").all() as Array<Record<string, unknown>>;
    const m = new Map<string, Record<string, unknown>>();
    for (const r of rows) m.set(String(r.file_path), r);
    return m;
  }

  private upsertManifest(relPath: string, fileHash: string, mtimeNs: number, sizeBytes: number): void {
    this.db
      .prepare(
        `INSERT INTO file_manifest(file_path, file_hash, mtime_ns, size_bytes, last_indexed_at, root_kind)
         VALUES (?, ?, ?, ?, ?, 'project')
         ON CONFLICT(file_path) DO UPDATE SET
           file_hash=excluded.file_hash,
           mtime_ns=excluded.mtime_ns,
           size_bytes=excluded.size_bytes,
           last_indexed_at=excluded.last_indexed_at,
           root_kind=excluded.root_kind`,
      )
      .run(relPath, fileHash, mtimeNs, sizeBytes, utcIso());
  }

  private deleteManifestNotIn(scanned: Set<string>): void {
    if (scanned.size === 0) {
      this.db.exec("DELETE FROM file_manifest");
      return;
    }
    const list = [...scanned];
    const placeholders = list.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM file_manifest WHERE file_path NOT IN (${placeholders})`).run(...list);
  }

  private replaceChunksForFile(sourceFile: string, chunks: ChunkRecord[]): { upserted: number; deleted: number } {
    const deleted = Number(this.db.prepare("DELETE FROM memory_chunks WHERE source_file = ?").run(sourceFile).changes || 0);
    if (chunks.length === 0) return { upserted: 0, deleted };

    const now = utcIso();
    const stmt = this.db.prepare(
      `INSERT INTO memory_chunks(
        lookup_path, parent_path, chunk_order, content, token_count,
        source_file, start_line, end_line, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction((records: ChunkRecord[]) => {
      for (const c of records) {
        stmt.run(
          c.lookupPath,
          c.parentPath,
          c.chunkOrder,
          c.content,
          c.tokenCount,
          c.sourceFile,
          c.startLine,
          c.endLine,
          now,
          now,
        );
      }
      this.db
        .prepare(
          `INSERT OR IGNORE INTO memory_index(chunk_id, access_count, last_accessed)
           SELECT chunk_id, 0, NULL FROM memory_chunks WHERE source_file = ?`,
        )
        .run(sourceFile);
    });
    tx(chunks);
    return { upserted: chunks.length, deleted };
  }

  private deleteMissingChunks(scanned: Set<string>): number {
    if (scanned.size === 0) {
      return Number(this.db.prepare("DELETE FROM memory_chunks").run().changes || 0);
    }
    const list = [...scanned];
    const placeholders = list.map(() => "?").join(",");
    return Number(this.db.prepare(`DELETE FROM memory_chunks WHERE source_file NOT IN (${placeholders})`).run(...list).changes || 0);
  }

  private rebuildLookupPaths(): void {
    this.db.exec("DELETE FROM memory_lookup_paths");
    const rows = this.db
      .prepare(
        `SELECT lookup_path, parent_path, COUNT(*) AS chunk_count
         FROM memory_chunks
         GROUP BY lookup_path, parent_path`,
      )
      .all() as Array<Record<string, unknown>>;

    const insert = this.db.prepare(
      `INSERT INTO memory_lookup_paths(lookup_path, parent_path, depth, chunk_count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(lookup_path) DO NOTHING`,
    );

    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const p = String(r.lookup_path);
        insert.run(p, r.parent_path ?? null, p.split(".").length, Number(r.chunk_count || 0));
      }

      for (const r of rows) {
        const p = String(r.lookup_path);
        const parts = p.split(".");
        for (let i = 1; i < parts.length; i += 1) {
          const parent = parts.slice(0, i).join(".");
          const pp = i > 1 ? parts.slice(0, i - 1).join(".") : null;
          insert.run(parent, pp, i, 0);
        }
      }

      this.db.exec(`
        UPDATE memory_lookup_paths
        SET child_count = (
          SELECT COUNT(*) FROM memory_lookup_paths c
          WHERE c.parent_path = memory_lookup_paths.lookup_path
        )
      `);
    });
    tx();
  }

  private rebuildTerms(): void {
    this.db.exec("DROP INDEX IF EXISTS idx_memory_terms_term");
    this.db.exec("DROP INDEX IF EXISTS idx_memory_terms_lookup_path");
    this.db.exec("DELETE FROM memory_terms");

    const rows = this.db
      .prepare("SELECT lookup_path, GROUP_CONCAT(content, ' ') AS content FROM memory_chunks GROUP BY lookup_path")
      .all() as Array<Record<string, unknown>>;

    const batch: Array<[string, string, number]> = [];

    for (const r of rows) {
      const lookupPath = String(r.lookup_path);
      const content = String(r.content || "");
      const parts = lookupPath.split(".").filter(Boolean);
      const weights = new Map<string, number>();

      const add = (term: string | null, weight: number) => {
        if (!term) return;
        weights.set(term, (weights.get(term) || 0) + weight);
      };

      parts.forEach((t, idx) => {
        add(safeTerm(t), 1.0 + (parts.length - idx) * 0.2);
        const words = t.split("_").filter((w) => w.length >= 3);
        if (words.length > 1) {
          words.forEach((w) => add(w, 0.7 + (parts.length - idx) * 0.1));
        }
      });

      add(safeTerm(parts.join("")), 0.8);

      const freq = new Map<string, number>();
      for (const t of tokenizeTerms(content)) freq.set(t, (freq.get(t) || 0) + 1);
      [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 120)
        .forEach(([t, c]) => add(t, Math.min(0.65, 0.2 + c * 0.07)));

      const labelMatches = content.match(/(?m)^\s*[-*]\s*([^:\n]{2,48})\s*:/g) || [];
      for (const raw of labelMatches) {
        const m = raw.match(/[-*]\s*([^:\n]{2,48})\s*:/);
        if (m) add(safeTerm(m[1] || ""), 1.1);
      }

      const names = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
      for (const phrase of names) {
        const p = phrase.toLowerCase().match(/[a-z0-9]+/g) || [];
        if (p.length >= 2) {
          add(safeTerm(p.join("")), 0.9);
          p.forEach((x) => add(safeTerm(x), 0.5));
        }
      }

      [...weights.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 140)
        .forEach(([t, w]) => batch.push([t, lookupPath, Number(w.toFixed(4))]));
    }

    batch.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const insert = this.db.prepare("INSERT INTO memory_terms(term, lookup_path, weight) VALUES (?, ?, ?)");
    const tx = this.db.transaction((rows0: Array<[string, string, number]>) => {
      for (const row of rows0) insert.run(...row);
    });
    tx(batch);

    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_terms_term ON memory_terms(term)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_memory_terms_lookup_path ON memory_terms(lookup_path)");
  }

  private rebuildFacts(): void {
    this.db.exec("DELETE FROM memory_facts");
    const rows = this.db
      .prepare(
        `SELECT chunk_id, lookup_path, content
         FROM memory_chunks
         ORDER BY chunk_id ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const insert = this.db.prepare(
      `INSERT INTO memory_facts(chunk_id, lookup_path, subject, predicate, object, weight)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (const r of rows) {
        const chunkId = Number(r.chunk_id);
        const lookupPath = String(r.lookup_path);
        const content = String(r.content || "");
        const lines = content.split(/\r?\n/).map((ln) => ln.trim()).filter(Boolean);

        const kv = new Map<string, string>();
        for (const ln of lines) {
          const m = ln.match(/^[-*]\s*([^:\n]{2,48})\s*:\s*(.+)$/);
          if (!m) continue;
          const key = normalizePredicate(m[1] || "");
          const val = (m[2] || "").trim();
          if (!key || !val) continue;
          if (!kv.has(key)) kv.set(key, val);
        }

        const subject = kv.get("name") || kv.get("person") || kv.get("contact") || null;
        for (const [k, v] of kv.entries()) {
          insert.run(chunkId, lookupPath, subject, k, v.slice(0, 280), 1.0);
        }
      }
    });
    tx();
  }

  async index(scope: "all" | "changed" = "changed", cwd = process.cwd()): Promise<Record<string, unknown>> {
    const started = Date.now();
    const scanned = await this.discoverFiles(cwd);
    const scannedSet = new Set(scanned.map((f) => f.relPath));

    const manifest = this.getManifest();
    const changed: DiscoveredFile[] = [];

    for (const f of scanned) {
      let st: fs.Stats;
      try {
        st = fs.statSync(f.absPath);
      } catch {
        continue;
      }
      const prev = manifest.get(f.relPath);
      const stRec = st as unknown as { mtimeNs?: number | bigint };
      const mtimeNs =
        typeof stRec.mtimeNs === "bigint"
          ? Number(stRec.mtimeNs)
          : typeof stRec.mtimeNs === "number"
            ? stRec.mtimeNs
            : Math.trunc(st.mtimeMs * 1_000_000);
      const mtimeMatch = prev && Number(prev.mtime_ns || 0) === mtimeNs && Number(prev.size_bytes || 0) === st.size;
      const hash = scope === "all" || !mtimeMatch ? this.hashFile(f.absPath) : String(prev?.file_hash || "");
      const isChanged = scope === "all" || !prev || String(prev.file_hash || "") !== hash || !mtimeMatch;
      if (isChanged) changed.push(f);

      this.upsertManifest(f.relPath, hash, mtimeNs, st.size);
    }

    let chunksUpserted = 0;
    let chunksDeleted = 0;

    for (const f of changed) {
      let text = "";
      try {
        text = await fsp.readFile(f.absPath, "utf-8");
      } catch {
        continue;
      }
      const blocks = parseMarkdownBlocks(text);
      const chunks = chunkBlocks(f.relPath, blocks);
      const { upserted, deleted } = this.replaceChunksForFile(f.relPath, chunks);
      chunksUpserted += upserted;
      chunksDeleted += deleted;
    }

    chunksDeleted += this.deleteMissingChunks(scannedSet);
    this.deleteManifestNotIn(scannedSet);

    if (chunksUpserted || chunksDeleted) {
      this.rebuildLookupPaths();
      this.rebuildTerms();
      this.rebuildFacts();
    }

    const ended = Date.now();
    this.db
      .prepare(
        `INSERT INTO index_runs (
          started_at, ended_at, scope, files_scanned, files_changed,
          nodes_upserted, nodes_deleted, status, error_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(new Date(started).toISOString(), new Date(ended).toISOString(), scope, scanned.length, changed.length, chunksUpserted, chunksDeleted, "ok", null);

    return {
      indexed_files: changed.length,
      scanned_files: scanned.length,
      indexed_chunks: chunksUpserted,
      deleted_chunks: chunksDeleted,
      duration_ms: ended - started,
      scope,
    };
  }

  private recordAccess(chunkIds: number[]): void {
    if (!chunkIds.length) return;
    const stmt = this.db.prepare(
      `UPDATE memory_index
       SET access_count = access_count + 1,
           last_accessed = ?
       WHERE chunk_id = ?`,
    );
    const now = utcIso();
    const tx = this.db.transaction((ids: number[]) => {
      for (const id of ids) stmt.run(now, id);
    });
    tx(chunkIds);
  }

  pathRoot(): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    try {
      const rows = this.db
        .prepare(
          `SELECT lookup_path, child_count
           FROM memory_lookup_paths
           WHERE parent_path IS NULL
           ORDER BY lookup_path ASC`,
        )
        .all() as Array<Record<string, unknown>>;
      return ok({ items: rows.map((r) => r.lookup_path) }, started);
    } catch (e) {
      return err("DB_ERROR", "Failed to list path roots", { reason: String(e) }, started);
    }
  }

  pathChildren(pathArg: string, limitArg: number, cursorArg?: string): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    try {
      const pathVal = (pathArg || "").trim();
      const limit = Math.max(1, Math.min(500, Math.trunc(limitArg || 100)));
      const cursor = (cursorArg || "").trim();

      let rows: Array<Record<string, unknown>>;
      if (pathVal) {
        if (cursor) {
          rows = this.db
            .prepare(
              `SELECT lookup_path, child_count
               FROM memory_lookup_paths
               WHERE parent_path = ? AND lookup_path > ?
               ORDER BY lookup_path ASC
               LIMIT ?`,
            )
            .all(pathVal, cursor, limit) as Array<Record<string, unknown>>;
        } else {
          rows = this.db
            .prepare(
              `SELECT lookup_path, child_count
               FROM memory_lookup_paths
               WHERE parent_path = ?
               ORDER BY lookup_path ASC
               LIMIT ?`,
            )
            .all(pathVal, limit) as Array<Record<string, unknown>>;
        }
      } else if (cursor) {
        rows = this.db
          .prepare(
            `SELECT lookup_path, child_count
             FROM memory_lookup_paths
             WHERE parent_path IS NULL AND lookup_path > ?
             ORDER BY lookup_path ASC
             LIMIT ?`,
          )
          .all(cursor, limit) as Array<Record<string, unknown>>;
      } else {
        rows = this.db
          .prepare(
            `SELECT lookup_path, child_count
             FROM memory_lookup_paths
             WHERE parent_path IS NULL
             ORDER BY lookup_path ASC
             LIMIT ?`,
          )
          .all(limit) as Array<Record<string, unknown>>;
      }

      const items = rows.map((r) => ({ lookup_path: r.lookup_path, child_count: r.child_count }));
      const nextCursor = rows.length ? String(rows[rows.length - 1].lookup_path) : null;
      return ok({ items, next_cursor: nextCursor }, started);
    } catch (e) {
      return err("DB_ERROR", "Failed to list path children", { reason: String(e) }, started);
    }
  }

  pathLookup(pathArg: string, maxTokensArg?: number, limitArg?: number): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    try {
      const lookup = pathArg.trim();
      const maxTokens = Math.max(1, Math.trunc(maxTokensArg || this.settings.maxTokensPerQuery));
      const limit = Math.max(1, Math.min(200, Math.trunc(limitArg || 20)));
      const trace: TraceStep[] = [{ stage: "exact_path", detail: lookup }];

      let rows = this.db
        .prepare(
          `SELECT c.*, i.access_count, i.last_accessed
           FROM memory_chunks c
           LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
           WHERE c.lookup_path = ?
           ORDER BY c.chunk_order ASC`,
        )
        .all(lookup) as Array<Record<string, unknown>>;

      if (rows.length === 0) {
        trace.push({ stage: "prefix_path", detail: lookup });
        rows = this.db
          .prepare(
            `SELECT c.*, i.access_count, i.last_accessed
             FROM memory_chunks c
             LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
             WHERE c.lookup_path LIKE ?
             ORDER BY c.lookup_path ASC, c.chunk_order ASC
             LIMIT ?`,
          )
          .all(`${lookup}.%`, Math.max(50, limit * 5)) as Array<Record<string, unknown>>;
      }

      if (rows.length === 0) {
        const term = lookup.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (term) {
          trace.push({ stage: "term_reverse", detail: term });
          rows = this.db
            .prepare(
              `SELECT c.*, i.access_count, i.last_accessed, t.term AS matched_term, t.weight AS term_weight
               FROM memory_terms t
               JOIN memory_chunks c ON c.lookup_path = t.lookup_path
               LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
               WHERE t.term = ?
               ORDER BY t.weight DESC, c.lookup_path ASC, c.chunk_order ASC
               LIMIT ?`,
            )
            .all(term, Math.max(20, limit * 3)) as Array<Record<string, unknown>>;
        }
      }

      let hits = rows.map((r) => rowToHit(r, activation(r), this.settings.snippetChars));
      hits = applyTokenBudget(hits.slice(0, limit), maxTokens);
      this.recordAccess(hits.map((h) => Number(h.chunk_id || 0)).filter((n) => n > 0));
      return ok({ items: hits, retrieval_trace: trace }, started);
    } catch (e) {
      return err("DB_ERROR", "Failed path lookup", { reason: String(e) }, started);
    }
  }

  textSearch(queryArg: string, pathPrefixArg?: string, maxTokensArg?: number, limitArg?: number): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    const query = queryArg.trim();
    if (!query) {
      return err("INVALID_QUERY", "query must not be empty", {}, started);
    }

    try {
      const limit = Math.max(1, Math.min(200, Math.trunc(limitArg || 20)));
      const maxTokens = Math.max(1, Math.trunc(maxTokensArg || this.settings.maxTokensPerQuery));
      const pathPrefix = pathPrefixArg?.trim();
      const trace: TraceStep[] = [];

      const hitsById = new Map<number, Record<string, unknown>>();
      const maxRows = Math.max(1, Math.min(limit * 6, 400));
      const sigTerms = significantTerms(query).slice(0, 8);

      const predicates = inferPredicates(query);
      const subjectTokens = extractSubjectTokens(query);
      if (predicates.length || subjectTokens.length) {
        const where: string[] = [];
        const args: unknown[] = [];
        if (predicates.length) {
          where.push(`(${predicates.map(() => "f.predicate = ?").join(" OR ")})`);
          args.push(...predicates);
        }
        for (const tok of subjectTokens) {
          where.push("(LOWER(COALESCE(f.subject, '')) LIKE ? OR LOWER(f.object) LIKE ?)");
          const like = `%${tok.toLowerCase()}%`;
          args.push(like, like);
        }
        args.push(Math.max(12, limit * 3));
        const sql = `
          SELECT c.*, i.access_count, i.last_accessed,
                 f.predicate AS fact_predicate, f.subject AS fact_subject, f.object AS fact_object, f.weight AS fact_weight
          FROM memory_facts f
          JOIN memory_chunks c ON c.chunk_id = f.chunk_id
          LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
          WHERE ${where.join(" AND ") || "1=1"}
          ORDER BY f.weight DESC, c.lookup_path ASC, c.chunk_order ASC
          LIMIT ?
        `;
        const rows = this.db.prepare(sql).all(...args) as Array<Record<string, unknown>>;
        trace.push({
          stage: "fact_index",
          detail: `predicates=${JSON.stringify(predicates)}; subject_tokens=${JSON.stringify(subjectTokens)}; hits=${rows.length}`,
        });
        for (const r of rows) {
          const h = rowToHit(r, 3.0, this.settings.snippetChars);
          const id = Number(h.chunk_id || 0);
          const prev = hitsById.get(id);
          if (!prev || Number(h.score || 0) > Number(prev.score || 0)) hitsById.set(id, h);
        }
      }

      const variants = queryVariants(query);
      for (const v of variants) {
        const args: unknown[] = [v.q];
        let likeClause = "";
        if (pathPrefix) {
          likeClause = " AND c.lookup_path LIKE ?";
          args.push(`${pathPrefix}%`);
        }
        args.push(maxRows);
        const rows = this.db
          .prepare(
            `SELECT c.*, i.access_count, i.last_accessed,
                    bm25(memory_fts) AS rank,
                    snippet(memory_fts, 0, '', '', ' ... ', 64) AS fts_snippet
             FROM memory_fts f
             JOIN memory_chunks c ON c.chunk_id = f.rowid
             LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
             WHERE memory_fts MATCH ?${likeClause}
             ORDER BY rank ASC, c.lookup_path ASC, c.chunk_order ASC
             LIMIT ?`,
          )
          .all(...args) as Array<Record<string, unknown>>;

        trace.push({ stage: v.label, detail: `query=${v.q}; hits=${rows.length}` });
        for (const r of rows) {
          const bm25 = Math.max(0, -Number(r.rank || 0));
          const score =
            2.0 * (bm25 / (1.0 + bm25)) +
            1.25 * overlap(String(r.content || ""), sigTerms) +
            Math.min(0.5, activation(r) * 0.1);
          const h = rowToHit(r, score, this.settings.snippetChars);
          const id = Number(h.chunk_id || 0);
          const prev = hitsById.get(id);
          if (!prev || Number(h.score || 0) > Number(prev.score || 0)) hitsById.set(id, h);
        }

        if (hitsById.size >= Math.max(8, limit * 2)) break;
      }

      if (hitsById.size < Math.max(2, Math.floor(limit / 2)) && sigTerms.length > 0) {
        let added = 0;
        for (const term of sigTerms) {
          const rows = this.db
            .prepare(
              `SELECT c.*, i.access_count, i.last_accessed,
                      t.term AS matched_term, t.weight AS term_weight
               FROM memory_terms t
               JOIN memory_chunks c ON c.lookup_path = t.lookup_path
               LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
               WHERE t.term = ?
               ORDER BY t.weight DESC, c.lookup_path ASC, c.chunk_order ASC
               LIMIT ?`,
            )
            .all(term, Math.max(8, limit * 2)) as Array<Record<string, unknown>>;
          trace.push({ stage: "term_index", detail: `term=${term}; hits=${rows.length}` });
          for (const r of rows) {
            const boost = Math.min(0.5, Number(r.term_weight || 0) * 0.3);
            const score = 0.3 + boost + Math.min(0.5, activation(r) * 0.1);
            const h = rowToHit(r, score, this.settings.snippetChars);
            const id = Number(h.chunk_id || 0);
            const prev = hitsById.get(id);
            if (!prev) {
              hitsById.set(id, h);
              added += 1;
            } else if (Number(h.score || 0) > Number(prev.score || 0)) {
              hitsById.set(id, h);
            }
          }
        }
        if (added > 0) trace.push({ stage: "term_index_expand", detail: `added=${added}` });
      }

      const topHits = [...hitsById.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      const parentAnchors: Array<{ parent: string; score: number }> = [];
      const seenParents = new Set<string>();
      for (const h of topHits.slice(0, 5)) {
        const lp = String(h.lookup_path || "");
        const parent = lp.includes(".") ? lp.slice(0, lp.lastIndexOf(".")) : "";
        if (!parent || seenParents.has(parent)) continue;
        seenParents.add(parent);
        parentAnchors.push({ parent, score: Number(h.score || 0) });
      }

      let expanded = 0;
      for (const { parent, score } of parentAnchors) {
        const rows = this.db
          .prepare(
            `SELECT c.*, i.access_count, i.last_accessed
             FROM memory_chunks c
             LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
             WHERE c.parent_path = ?
             ORDER BY c.lookup_path ASC, c.chunk_order ASC
             LIMIT ?`,
          )
          .all(parent, 8) as Array<Record<string, unknown>>;

        for (const r of rows) {
          const siblingScore = Math.max(0.3, score * 0.75);
          const h = rowToHit(r, siblingScore, this.settings.snippetChars);
          const id = Number(h.chunk_id || 0);
          const prev = hitsById.get(id);
          if (!prev) {
            hitsById.set(id, h);
            expanded += 1;
          } else if (siblingScore > Number(prev.score || 0)) {
            hitsById.set(id, { ...prev, score: Number(siblingScore.toFixed(4)) });
          }
        }
      }
      if (expanded > 0) trace.push({ stage: "parent_expand", detail: `added=${expanded}` });

      let hits = [...hitsById.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
      hits = applyTokenBudget(hits.slice(0, limit), maxTokens);
      this.recordAccess(hits.map((h) => Number(h.chunk_id || 0)).filter((n) => n > 0));

      return ok({ items: hits, retrieval_trace: trace }, started);
    } catch (e) {
      return err("DB_ERROR", "Failed text search", { reason: String(e) }, started);
    }
  }

  chunkFetch(chunkIdArg: number): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    try {
      const chunkId = Math.trunc(chunkIdArg);
      const row = this.db
        .prepare(
          `SELECT c.*, i.access_count, i.last_accessed
           FROM memory_chunks c
           LEFT JOIN memory_index i ON i.chunk_id = c.chunk_id
           WHERE c.chunk_id = ?`,
        )
        .get(chunkId) as Record<string, unknown> | undefined;
      if (!row) return ok({ item: null }, started);
      this.recordAccess([chunkId]);
      return ok(
        {
          item: {
            path: row.source_file,
            from: row.start_line,
            lines: Number(row.end_line || 0) - Number(row.start_line || 0) + 1,
            text: row.content,
            chunk_id: row.chunk_id,
            lookup_path: row.lookup_path,
            token_count: row.token_count,
            chunk_order: row.chunk_order,
          },
        },
        started,
      );
    } catch (e) {
      return err("DB_ERROR", "Failed chunk fetch", { reason: String(e) }, started);
    }
  }

  savings(): EnvelopeOk | EnvelopeErr {
    const started = Date.now();
    try {
      const total = readTotalSaved();
      return ok(
        {
          total_tokens_saved: total,
          ...costAvoided(0, total),
        },
        started,
      );
    } catch (e) {
      return err("DB_ERROR", "Failed savings", { reason: String(e) }, started);
    }
  }
}

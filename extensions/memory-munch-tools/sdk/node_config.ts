import fs from "node:fs";
import path from "node:path";

export type NodeBackendSettings = {
  dbPath: string;
  roots: string[];
  includeGlobs: string[];
  excludeGlobs: string[];
  followSymlinks: boolean;
  maxTokensPerQuery: number;
  snippetChars: number;
};

const DEFAULT_EXCLUDES = [
  ".git/**",
  ".pytest_cache/**",
  "node_modules/**",
  ".venv/**",
  "dist/**",
  "build/**",
  ".secrets/**",
  "private/**",
  "**/*password*.md",
  "**/*secret*.md",
  "**/*token*.md",
];

function defaultSettings(): NodeBackendSettings {
  const home = process.env.HOME || "~";
  return {
    dbPath: ".memorymunch/memory.db",
    roots: [`${home}/.openclaw/workspace`],
    includeGlobs: ["MEMORY.md", "memory/**/*.md"],
    excludeGlobs: [...DEFAULT_EXCLUDES],
    followSymlinks: false,
    maxTokensPerQuery: 1200,
    snippetChars: 200,
  };
}

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  if (v.startsWith("[") && v.endsWith("]")) {
    const body = v.slice(1, -1).trim();
    if (!body) return [];
    return body
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s));
  }
  return v;
}

function parseSimpleToml(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let pendingKey = "";
  let pending = "";

  for (const line0 of lines) {
    const line = line0.split("#")[0].trim();
    if (!line) continue;

    if (pendingKey) {
      pending += ` ${line}`;
      if (line.includes("]")) {
        out[pendingKey] = parseValue(pending);
        pendingKey = "";
        pending = "";
      }
      continue;
    }

    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value.startsWith("[") && !value.includes("]")) {
      pendingKey = key;
      pending = value;
      continue;
    }
    out[key] = parseValue(value);
  }

  return out;
}

function expandUser(p: string): string {
  if (p.startsWith("~/") && process.env.HOME) {
    return path.join(process.env.HOME, p.slice(2));
  }
  return p;
}

export function loadNodeBackendSettings(configPath: string): NodeBackendSettings {
  const defaults = defaultSettings();
  if (!fs.existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = parseSimpleToml(fs.readFileSync(configPath, "utf-8"));
    return {
      dbPath: typeof raw.db_path === "string" ? raw.db_path : defaults.dbPath,
      roots: Array.isArray(raw.roots)
        ? raw.roots.filter((v): v is string => typeof v === "string").map(expandUser)
        : defaults.roots,
      includeGlobs: Array.isArray(raw.include_globs)
        ? raw.include_globs.filter((v): v is string => typeof v === "string")
        : defaults.includeGlobs,
      excludeGlobs: Array.isArray(raw.exclude_globs)
        ? raw.exclude_globs.filter((v): v is string => typeof v === "string")
        : defaults.excludeGlobs,
      followSymlinks: typeof raw.follow_symlinks === "boolean" ? raw.follow_symlinks : defaults.followSymlinks,
      maxTokensPerQuery:
        typeof raw.max_tokens_per_query === "number" ? Math.max(1, Math.trunc(raw.max_tokens_per_query)) : defaults.maxTokensPerQuery,
      snippetChars:
        typeof raw.snippet_chars === "number" ? Math.max(40, Math.trunc(raw.snippet_chars)) : defaults.snippetChars,
    };
  } catch {
    return defaults;
  }
}

export function resolveDbPath(configPath: string, dbPathSetting: string): string {
  const dbPath = expandUser(dbPathSetting);
  if (path.isAbsolute(dbPath)) {
    return dbPath;
  }
  return path.resolve(path.dirname(configPath), dbPath);
}

import path from "node:path";

const VALID_PATH_RE = /^[a-z0-9._-]+$/;

export function slugify(value: string): string {
  const s = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "untitled";
}

export function normalizeLookupPath(value: string): string {
  const p = value.trim().toLowerCase().replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");
  if (!p) throw new Error("lookup path cannot be empty");
  if (!VALID_PATH_RE.test(p)) throw new Error(`invalid lookup path: ${value}`);
  return p;
}

export function coerceLookupPath(value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "untitled";
  try {
    return normalizeLookupPath(raw);
  } catch {
    const parts = raw
      .split(".")
      .map((p) => slugify(p))
      .filter(Boolean);
    return normalizeLookupPath(parts.length ? parts.join(".") : "untitled");
  }
}

export function buildLookupPath(filePath: string, headingChain: string[]): string {
  const parsed = path.parse(filePath.replace(/\\/g, "/"));
  const dirParts = parsed.dir.split("/").filter(Boolean).map(slugify);
  const fileStem = slugify(parsed.name);
  const fileParts = [...dirParts, fileStem].filter(Boolean);
  const headingParts = headingChain.map(slugify).filter(Boolean);

  const raw = [...fileParts, ...headingParts];
  const parts: string[] = [];
  for (const seg of raw) {
    if (!seg) continue;
    if (parts.length === 0 || parts[parts.length - 1] !== seg) parts.push(seg);
  }

  return normalizeLookupPath(parts.slice(0, 6).join("."));
}

export function parentPath(lookupPath: string): string | null {
  const idx = lookupPath.lastIndexOf(".");
  return idx >= 0 ? lookupPath.slice(0, idx) : null;
}

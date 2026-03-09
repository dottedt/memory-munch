import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedPluginCfg } from "./client";

export async function readMemoryFileSnippet(
  cfg: ResolvedPluginCfg,
  params: { path: string; from?: number; lines?: number },
) {
  const relPath = params.path?.trim();
  if (!relPath) throw new Error("path is required");
  const from = Math.max(1, Math.trunc(params.from ?? 1));
  const lines = Math.max(1, Math.trunc(params.lines ?? 20));
  const workspace = path.resolve(path.dirname(cfg.configPath));
  const abs = path.resolve(workspace, relPath);
  if (!abs.startsWith(workspace + path.sep) && abs !== workspace) {
    throw new Error(`path must be within workspace: ${relPath}`);
  }
  const data = await readFile(abs, "utf-8");
  const all = data.split(/\r?\n/);
  const start = Math.max(1, from);
  const end = Math.min(all.length, start + lines - 1);
  return {
    path: relPath,
    from: start,
    lines: end >= start ? end - start + 1 : 0,
    text: all.slice(start - 1, end).join("\n"),
  };
}

import { spawn } from "node:child_process";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

export type PluginCfg = {
  pythonBin?: string;
  bridgeScript?: string;
  configPath?: string;
  timeoutMs?: number;
  autoInjectPromptContext?: boolean;
  exposeRawTools?: boolean;
  autoIndexWatch?: boolean;
  autoIndexWatchIntervalSec?: number;
};

export type ResolvedPluginCfg = {
  pythonBin: string;
  bridgeScript: string;
  configPath: string;
  timeoutMs: number;
  autoInjectPromptContext: boolean;
  exposeRawTools: boolean;
  autoIndexWatch: boolean;
  autoIndexWatchIntervalSec: number;
};

export function resolvePluginCfg(api: OpenClawPluginApi): ResolvedPluginCfg {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const home = process.env.HOME || "";
  const defaultWorkspace = home ? `${home}/.openclaw/workspace` : ".";
  return {
    pythonBin: cfg.pythonBin?.trim() || process.env.MEMORY_MUNCH_PYTHON || "python3",
    bridgeScript:
      cfg.bridgeScript?.trim() || process.env.MEMORY_MUNCH_BRIDGE || "openclaw_memory_munch_bridge.py",
    configPath:
      cfg.configPath?.trim() || process.env.MEMORY_MUNCH_CONFIG || `${defaultWorkspace}/dmemorymunch-mpc.toml`,
    timeoutMs:
      typeof cfg.timeoutMs === "number" && cfg.timeoutMs >= 1000 ? Math.floor(cfg.timeoutMs) : 15000,
    autoInjectPromptContext:
      typeof cfg.autoInjectPromptContext === "boolean"
        ? cfg.autoInjectPromptContext
        : process.env.MEMORY_MUNCH_AUTO_INJECT === "1",
    exposeRawTools:
      typeof cfg.exposeRawTools === "boolean"
        ? cfg.exposeRawTools
        : process.env.MEMORY_MUNCH_EXPOSE_RAW_TOOLS === "1",
    autoIndexWatch:
      typeof cfg.autoIndexWatch === "boolean"
        ? cfg.autoIndexWatch
        : process.env.MEMORY_MUNCH_AUTO_INDEX_WATCH !== "0",
    autoIndexWatchIntervalSec:
      typeof cfg.autoIndexWatchIntervalSec === "number" && cfg.autoIndexWatchIntervalSec >= 0.5
        ? cfg.autoIndexWatchIntervalSec
        : 1.5,
  };
}

export class MemoryMunchClient {
  constructor(private readonly cfg: ResolvedPluginCfg) {}

  async call(args: string[]): Promise<unknown> {
    return await new Promise((resolve, reject) => {
      const proc = spawn(this.cfg.pythonBin, [this.cfg.bridgeScript, "--config", this.cfg.configPath, ...args], {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let out = "";
      let err = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        proc.kill("SIGKILL");
        reject(new Error(`memory-munch bridge timed out after ${this.cfg.timeoutMs}ms`));
      }, this.cfg.timeoutMs);

      proc.stdout.on("data", (d) => {
        out += String(d);
      });
      proc.stderr.on("data", (d) => {
        err += String(d);
      });

      proc.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(e);
      });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`bridge failed (${code}): ${err || out}`));
          return;
        }
        try {
          resolve(JSON.parse(out.trim() || "{}"));
        } catch (e) {
          reject(new Error(`bridge returned invalid JSON: ${String(e)} :: ${out}`));
        }
      });
    });
  }
}

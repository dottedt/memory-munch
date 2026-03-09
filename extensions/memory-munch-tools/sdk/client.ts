import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { NodeBridge } from "./node_bridge";

export type PluginCfg = {
  configPath?: string;
  timeoutMs?: number;
  autoInjectPromptContext?: boolean;
  exposeRawTools?: boolean;
  autoIndexWatch?: boolean;
  autoIndexWatchIntervalSec?: number;
  autoFlushOnCompaction?: boolean;
};

export type ResolvedPluginCfg = {
  configPath: string;
  timeoutMs: number;
  autoInjectPromptContext: boolean;
  exposeRawTools: boolean;
  autoIndexWatch: boolean;
  autoIndexWatchIntervalSec: number;
  autoFlushOnCompaction: boolean;
};

export function resolvePluginCfg(api: OpenClawPluginApi): ResolvedPluginCfg {
  const cfg = (api.pluginConfig ?? {}) as PluginCfg;
  const home = process.env.HOME || "";
  const defaultWorkspace = home ? `${home}/.openclaw/workspace` : ".";
  return {
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
    autoFlushOnCompaction:
      typeof cfg.autoFlushOnCompaction === "boolean" ? cfg.autoFlushOnCompaction : true,
  };
}

export class MemoryMunchClient {
  private readonly nodeBridge: NodeBridge;

  constructor(cfg: ResolvedPluginCfg) {
    this.nodeBridge = new NodeBridge(cfg.configPath);
  }

  close(): void {
    this.nodeBridge.close();
  }

  async call(args: string[]): Promise<unknown> {
    return await this.nodeBridge.call(args);
  }
}

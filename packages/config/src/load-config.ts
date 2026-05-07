import type { RoundtableConfig } from "@roundtable/core";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { PartialConfig } from "./schema.js";

export { DEFAULT_CONFIG };

type ResolveInput = {
  env?: Record<string, string | undefined>;
  globalConfig?: PartialConfig;
  projectConfig?: PartialConfig;
  cliOverrides?: PartialConfig;
};

export function resolveConfig(input: ResolveInput): RoundtableConfig {
  const { env = {}, globalConfig = {}, projectConfig = {}, cliOverrides = {} } = input;

  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Layer 1: ROUNDTABLE_HOME env var
  if (env.ROUNDTABLE_HOME) {
    config.dataDir = env.ROUNDTABLE_HOME;
  }

  // Layer 2: global config (~/.config/roundtable/config.yaml)
  config = deepMerge(config, globalConfig);

  // Layer 3: project config (roundtable.config.yaml / .roundtable/config.yaml)
  config = deepMerge(config, projectConfig);

  // Layer 4: CLI flags
  config = deepMerge(config, cliOverrides);

  // Re-apply env override (it wins over config files but not CLI flags)
  if (env.ROUNDTABLE_HOME && !cliOverrides.dataDir) {
    config.dataDir = env.ROUNDTABLE_HOME;
  }

  return config;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: unknown): T {
  if (!source || typeof source !== "object") return target;
  const result = { ...target };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = result[key as keyof T];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        existing as Record<string, unknown>,
        value,
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

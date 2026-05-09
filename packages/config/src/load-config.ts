import type { WardroomConfig } from "@wardroom/core";
import { DEFAULT_CONFIG } from "./defaults.js";
import type { PartialConfig } from "./schema.js";

export { DEFAULT_CONFIG };

type ResolveInput = {
  env?: Record<string, string | undefined>;
  globalConfig?: PartialConfig;
  projectConfig?: PartialConfig;
  cliOverrides?: PartialConfig;
};

export function resolveConfig(input: ResolveInput): WardroomConfig {
  const { env = {}, globalConfig = {}, projectConfig = {}, cliOverrides = {} } = input;

  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Layer 2: global config (~/.config/wardroom/config.yaml)
  config = deepMerge(config, globalConfig);

  // Layer 3: project config (wardroom.config.yaml / .wardroom/config.yaml)
  config = deepMerge(config, projectConfig);

  // WARDROOM_HOME env var overrides config files but not CLI flags
  if (env.WARDROOM_HOME) {
    config.dataDir = env.WARDROOM_HOME;
  }

  // Layer 4: CLI flags (highest precedence)
  config = deepMerge(config, cliOverrides);

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

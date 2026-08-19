import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { PartialConfigSchema, type PartialConfig } from "./schema.js";

/**
 * Try to read and parse a YAML config file.
 * Returns null if the file doesn't exist.
 * Throws if the file exists but is malformed.
 */
export async function loadYamlConfig(filePath: string): Promise<PartialConfig | null> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const raw = parseYaml(content);
  if (!raw || typeof raw !== "object") return null;

  const result = PartialConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid config in ${filePath}: ${result.error.message}`);
  }

  return result.data;
}

/**
 * Default location of the global config file:
 * $XDG_CONFIG_HOME/wardroom/config.yaml, falling back to ~/.config.
 */
export function defaultGlobalConfigPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(configHome, "wardroom", "config.yaml");
}

/**
 * Discover and load config files from disk.
 * Returns { globalConfig, projectConfig } ready for resolveConfig().
 *
 * Search order:
 * - Global: globalConfigPath, defaulting to $XDG_CONFIG_HOME/wardroom/config.yaml
 *   (~/.config/wardroom/config.yaml when XDG_CONFIG_HOME is unset)
 * - Project: wardroom.config.yaml or .wardroom/config.yaml in targetPath
 */
export async function loadConfigFiles(
  targetPath?: string,
  globalConfigPath: string = defaultGlobalConfigPath(),
): Promise<{
  globalConfig: PartialConfig;
  projectConfig: PartialConfig;
}> {
  const globalConfig = (await loadYamlConfig(globalConfigPath)) ?? {};

  // Project config — try two locations
  let projectConfig: PartialConfig = {};
  if (targetPath) {
    const candidate1 = join(targetPath, "wardroom.config.yaml");
    const candidate2 = join(targetPath, ".wardroom", "config.yaml");

    projectConfig = (await loadYamlConfig(candidate1)) ?? (await loadYamlConfig(candidate2)) ?? {};
  }

  return { globalConfig, projectConfig };
}

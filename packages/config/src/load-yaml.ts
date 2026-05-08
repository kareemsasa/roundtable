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
 * Discover and load config files from disk.
 * Returns { globalConfig, projectConfig } ready for resolveConfig().
 *
 * Search order:
 * - Global: ~/.config/roundtable/config.yaml
 * - Project: roundtable.config.yaml or .roundtable/config.yaml in targetPath
 */
export async function loadConfigFiles(targetPath?: string): Promise<{
  globalConfig: PartialConfig;
  projectConfig: PartialConfig;
}> {
  // Global config
  const globalPath = join(homedir(), ".config", "roundtable", "config.yaml");
  const globalConfig = (await loadYamlConfig(globalPath)) ?? {};

  // Project config — try two locations
  let projectConfig: PartialConfig = {};
  if (targetPath) {
    const candidate1 = join(targetPath, "roundtable.config.yaml");
    const candidate2 = join(targetPath, ".roundtable", "config.yaml");

    projectConfig = (await loadYamlConfig(candidate1)) ?? (await loadYamlConfig(candidate2)) ?? {};
  }

  return { globalConfig, projectConfig };
}

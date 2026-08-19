import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadYamlConfig, loadConfigFiles, defaultGlobalConfigPath } from "../load-yaml.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomUUID } from "node:crypto";

describe("loadYamlConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `rt-yaml-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
  });

  it("returns null for non-existent file", async () => {
    const result = await loadYamlConfig(join(dir, "nope.yaml"));
    expect(result).toBeNull();
  });

  it("parses a valid config file", async () => {
    const filePath = join(dir, "config.yaml");
    await writeFile(
      filePath,
      `context:
  budgetBytes: 50000
  maxFiles: 25
deliberation:
  maxRounds: 3
`,
      "utf-8",
    );

    const result = await loadYamlConfig(filePath);
    expect(result).not.toBeNull();
    expect(result!.context?.budgetBytes).toBe(50000);
    expect(result!.context?.maxFiles).toBe(25);
    expect(result!.deliberation?.maxRounds).toBe(3);
  });

  it("parses adapter command overrides", async () => {
    const filePath = join(dir, "config.yaml");
    await writeFile(
      filePath,
      `adapters:
  claude:
    command: /usr/local/bin/claude
  codex:
    command: /usr/local/bin/codex
`,
      "utf-8",
    );

    const result = await loadYamlConfig(filePath);
    expect(result).not.toBeNull();
    expect(result!.adapters?.claude?.command).toBe("/usr/local/bin/claude");
    expect(result!.adapters?.codex?.command).toBe("/usr/local/bin/codex");
  });

  it("returns null for empty file", async () => {
    const filePath = join(dir, "empty.yaml");
    await writeFile(filePath, "", "utf-8");
    const result = await loadYamlConfig(filePath);
    expect(result).toBeNull();
  });

  it("throws for invalid config schema", async () => {
    const filePath = join(dir, "bad.yaml");
    await writeFile(
      filePath,
      `context:
  budgetBytes: "not a number"
`,
      "utf-8",
    );

    await expect(loadYamlConfig(filePath)).rejects.toThrow("Invalid config");
  });
});

describe("loadConfigFiles", () => {
  let projectDir: string;
  let globalConfigPath: string;

  beforeEach(async () => {
    projectDir = join(tmpdir(), `rt-project-${randomUUID()}`);
    await mkdir(projectDir, { recursive: true });
    // Isolate from any real ~/.config/wardroom/config.yaml
    globalConfigPath = join(tmpdir(), `rt-global-${randomUUID()}`, "config.yaml");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads wardroom.config.yaml from project dir", async () => {
    await writeFile(
      join(projectDir, "wardroom.config.yaml"),
      `context:
  budgetBytes: 75000
`,
      "utf-8",
    );

    const { projectConfig } = await loadConfigFiles(projectDir, globalConfigPath);
    expect(projectConfig.context?.budgetBytes).toBe(75000);
  });

  it("loads .wardroom/config.yaml as fallback", async () => {
    await mkdir(join(projectDir, ".wardroom"), { recursive: true });
    await writeFile(
      join(projectDir, ".wardroom", "config.yaml"),
      `deliberation:
  maxRounds: 5
`,
      "utf-8",
    );

    const { projectConfig } = await loadConfigFiles(projectDir, globalConfigPath);
    expect(projectConfig.deliberation?.maxRounds).toBe(5);
  });

  it("prefers wardroom.config.yaml over .wardroom/config.yaml", async () => {
    await writeFile(
      join(projectDir, "wardroom.config.yaml"),
      `context:
  budgetBytes: 60000
`,
      "utf-8",
    );
    await mkdir(join(projectDir, ".wardroom"), { recursive: true });
    await writeFile(
      join(projectDir, ".wardroom", "config.yaml"),
      `context:
  budgetBytes: 40000
`,
      "utf-8",
    );

    const { projectConfig } = await loadConfigFiles(projectDir, globalConfigPath);
    expect(projectConfig.context?.budgetBytes).toBe(60000);
  });

  it("returns empty config when no files exist", async () => {
    const { globalConfig, projectConfig } = await loadConfigFiles(projectDir, globalConfigPath);
    expect(Object.keys(globalConfig).length).toBe(0);
    expect(Object.keys(projectConfig).length).toBe(0);
  });

  it("returns empty project config when no targetPath given", async () => {
    const { projectConfig } = await loadConfigFiles(undefined, globalConfigPath);
    expect(Object.keys(projectConfig).length).toBe(0);
  });

  it("loads the global config from an explicit path", async () => {
    await mkdir(dirname(globalConfigPath), { recursive: true });
    await writeFile(
      globalConfigPath,
      `deliberation:
  maxRounds: 7
`,
      "utf-8",
    );

    const { globalConfig } = await loadConfigFiles(projectDir, globalConfigPath);
    expect(globalConfig.deliberation?.maxRounds).toBe(7);
  });

  it("resolves the default global path from XDG_CONFIG_HOME when set", async () => {
    const configHome = join(tmpdir(), `rt-xdg-${randomUUID()}`);
    vi.stubEnv("XDG_CONFIG_HOME", configHome);
    await mkdir(join(configHome, "wardroom"), { recursive: true });
    await writeFile(
      join(configHome, "wardroom", "config.yaml"),
      `context:
  maxFiles: 12
`,
      "utf-8",
    );

    const { globalConfig } = await loadConfigFiles(projectDir);
    expect(globalConfig.context?.maxFiles).toBe(12);
  });
});

describe("defaultGlobalConfigPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses XDG_CONFIG_HOME when set", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/custom/config");
    expect(defaultGlobalConfigPath()).toBe(join("/custom/config", "wardroom", "config.yaml"));
  });

  it("falls back to ~/.config when XDG_CONFIG_HOME is unset", () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    expect(defaultGlobalConfigPath()).toBe(join(homedir(), ".config", "wardroom", "config.yaml"));
  });
});

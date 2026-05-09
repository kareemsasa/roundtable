import { Command } from "commander";
import { resolveConfig } from "@wardroom/config";
import { writeFile, stat } from "node:fs/promises";

export const configCommand = new Command("config").description("Manage configuration");

configCommand
  .command("show")
  .description("Show resolved configuration")
  .action(async () => {
    const config = resolveConfig({ env: process.env as Record<string, string> });
    console.log(JSON.stringify(config, null, 2));
  });

configCommand
  .command("init")
  .description("Generate a wardroom.config.yaml template")
  .action(async () => {
    const filename = "wardroom.config.yaml";
    try {
      await stat(filename);
      console.error(`Error: ${filename} already exists.`);
      process.exit(1);
    } catch {
      // File doesn't exist — good
    }

    const template = `# Wardroom Configuration
# See: docs/superpowers/specs/2026-05-06-wardroom-v1-design.md

context:
  budgetBytes: 100000
  maxFiles: 50
  maxFileBytes: 10000
  maxTreeDepth: 5
  # includes:
  #   - "src/**/*.ts"
  # excludes:
  #   - "**/*.test.ts"

deliberation:
  maxRounds: 2
  participantTimeoutMs: 120000
  deliberationTimeoutMs: 600000

adapters:
  claude:
    command: claude
  codex:
    command: codex
  steward:
    command: claude
`;

    await writeFile(filename, template, "utf-8");
    console.log(`Created ${filename}`);
  });

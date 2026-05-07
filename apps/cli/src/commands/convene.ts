import { Command } from "commander";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { resolveConfig } from "@roundtable/config";
import { FileSessionStore } from "@roundtable/persistence";
import { buildContextPack } from "@roundtable/context";
import { MockAdapter } from "@roundtable/adapters";
import { RoundtableEngine } from "@roundtable/core";
import { CLAUDE_SYSTEM_PROMPT, CODEX_SYSTEM_PROMPT, STEWARD_SYSTEM_PROMPT } from "../prompts.js";
import { renderEvent, resetRenderer } from "../render.js";
import { runInteractive } from "../interactive.js";
import type { RenderOptions } from "../render.js";

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export const conveneCommand = new Command("convene")
  .description("Start or resume a Roundtable deliberation")
  .argument("[path]", "Target folder path")
  .argument("[message]", "Initial message")
  .option("--session <id>", "Resume an existing session")
  .option("--once", "Run one deliberation and exit")
  .option("--max-rounds <n>", "Max deliberation rounds", parseInt)
  .option("--context-budget <n>", "Context budget in bytes", parseInt)
  .option("--max-files <n>", "Max files in context pack", parseInt)
  .option("--include <glob>", "Include pattern", collect, [])
  .option("--exclude <glob>", "Exclude pattern", collect, [])
  .option("--no-stream", "Disable streaming output")
  .option("--timeout <ms>", "Per-participant timeout in ms", parseInt)
  .option("--verbose", "Show invocation metadata")
  .option("--dry-run", "Preview context pack without invoking")
  .option("--mock", "Use mock adapters for testing")
  .action(async (pathArg: string | undefined, messageArg: string | undefined, options) => {
    // 1. Validate: --session and <path> are mutually exclusive
    if (options.session && pathArg) {
      console.error("Error: --session and <path> are mutually exclusive.");
      process.exit(1);
    }

    if (!options.session && !pathArg) {
      console.error("Error: either <path> or --session must be provided.");
      process.exit(1);
    }

    // 2. Build CLI overrides for config resolution
    const cliOverrides: Record<string, unknown> = {};

    if (options.maxRounds !== undefined) {
      cliOverrides.deliberation = { maxRounds: options.maxRounds };
    }
    if (options.contextBudget !== undefined) {
      cliOverrides.context = {
        ...(cliOverrides.context as Record<string, unknown> | undefined),
        budgetBytes: options.contextBudget,
      };
    }
    if (options.maxFiles !== undefined) {
      cliOverrides.context = {
        ...(cliOverrides.context as Record<string, unknown> | undefined),
        maxFiles: options.maxFiles,
      };
    }
    if (options.include && options.include.length > 0) {
      cliOverrides.context = {
        ...(cliOverrides.context as Record<string, unknown> | undefined),
        includes: options.include,
      };
    }
    if (options.exclude && options.exclude.length > 0) {
      cliOverrides.context = {
        ...(cliOverrides.context as Record<string, unknown> | undefined),
        excludes: options.exclude,
      };
    }
    if (options.timeout !== undefined) {
      cliOverrides.deliberation = {
        ...(cliOverrides.deliberation as Record<string, unknown> | undefined),
        participantTimeoutMs: options.timeout,
      };
    }

    // If --mock, override adapter modes
    if (options.mock) {
      const mockAdapterConfig = { mode: "mock" as const };
      cliOverrides.adapters = {
        claude: mockAdapterConfig,
        codex: mockAdapterConfig,
        steward: mockAdapterConfig,
      };
    }

    // 3. Resolve config
    const config = resolveConfig({
      env: process.env as Record<string, string | undefined>,
      cliOverrides,
    });

    // 4. Create session store
    const store = new FileSessionStore(config.dataDir);

    // 5. Create adapters
    if (!options.mock) {
      console.error("Error: real adapters not yet implemented, use --mock");
      process.exit(1);
    }

    const adapters = {
      claude: new MockAdapter({
        id: "claude",
        response:
          "This is Claude's mock response. I would provide thoughtful analysis of the project based on the context pack.",
        streamChunks: true,
      }),
      codex: new MockAdapter({
        id: "codex",
        response:
          "This is Codex's mock response. I would offer a complementary perspective on the codebase.",
        streamChunks: true,
      }),
      steward: new MockAdapter({
        id: "steward",
        response: JSON.stringify({
          status: "concluded",
          reason: "Both participants have provided their initial analysis.",
          summary:
            "The deliberation has concluded with initial perspectives from both Claude and Codex.",
        }),
      }),
    };

    // 6. Create engine
    const engine = new RoundtableEngine({
      store,
      adapters,
      config,
      systemPrompts: {
        claude: CLAUDE_SYSTEM_PROMPT,
        codex: CODEX_SYSTEM_PROMPT,
        steward: STEWARD_SYSTEM_PROMPT,
      },
    });

    // 7. Render options
    const renderOptions: RenderOptions = {
      verbose: options.verbose ?? false,
      // Commander treats --no-stream as negating the boolean `stream`
      stream: options.stream !== false,
    };

    // 8. Resume or start session
    if (options.session) {
      // Resume existing session
      try {
        const session = await engine.resumeSession(options.session);
        console.log(`Resumed session: ${session.meta.id}`);

        if (messageArg) {
          resetRenderer();
          const events = engine.submitMessage(session, messageArg);
          for await (const event of events) {
            renderEvent(event, renderOptions);
          }
          if (options.once) return;
        }

        await runInteractive({ engine, session, renderOptions, once: options.once ?? false });
      } catch (err) {
        console.error(
          `Error resuming session: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
      }
      return;
    }

    // New session: validate path is a directory
    const targetPath = resolve(pathArg!);
    try {
      const info = await stat(targetPath);
      if (!info.isDirectory()) {
        console.error(`Error: ${targetPath} is not a directory.`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: ${targetPath} does not exist or is not accessible.`);
      process.exit(1);
    }

    // Build context pack
    console.log("Building context pack...");
    const contextPack = await buildContextPack(targetPath, config.context);
    console.log(
      `Context pack: ${contextPack.stats.includedFiles} files, ${contextPack.stats.totalBytes} bytes`,
    );

    // 9. Dry run: display context pack preview and exit
    if (options.dryRun) {
      console.log();
      console.log("Context pack built:");
      console.log(`  Target: ${contextPack.displayPath}`);
      const omittedCount = contextPack.stats.totalFiles - contextPack.stats.includedFiles;
      console.log(`  Files: ${contextPack.stats.includedFiles} included, ${omittedCount} omitted`);
      console.log(
        `  Size: ${contextPack.stats.totalBytes} bytes (budget: ${contextPack.stats.budgetBytes})`,
      );
      console.log();
      console.log("Included files:");
      for (const file of contextPack.files) {
        console.log(`  [${file.category}] ${file.path} (${file.bytes} bytes)`);
      }
      if (contextPack.omitted.files.length > 0) {
        console.log();
        console.log("Omitted:");
        for (const omitted of contextPack.omitted.files) {
          console.log(`  ${omitted.path}: ${omitted.reason}`);
        }
      }
      console.log();
      console.log("Would invoke: Claude, Codex, Steward");
      return;
    }

    // 10. Start session
    const session = await engine.startSession(targetPath, contextPack);
    console.log(`Session started: ${session.meta.id}`);

    // 11. If message provided, run first deliberation
    if (messageArg) {
      resetRenderer();
      const events = engine.submitMessage(session, messageArg);
      for await (const event of events) {
        renderEvent(event, renderOptions);
      }
      if (options.once) return;
    }

    // 12. Enter interactive mode (unless --once with no message — just exit)
    if (options.once && !messageArg) {
      console.log("No message provided with --once flag. Session created but no deliberation run.");
      return;
    }

    await runInteractive({ engine, session, renderOptions, once: options.once ?? false });
  });

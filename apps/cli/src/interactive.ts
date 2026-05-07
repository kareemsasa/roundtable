import { createInterface } from "node:readline";
import type { Session } from "@roundtable/core";
import type { RoundtableEngine } from "@roundtable/core";
import { generateTranscriptMarkdown } from "@roundtable/persistence";
import { buildContextPack } from "@roundtable/context";
import { renderEvent, resetRenderer } from "./render.js";
import type { RenderOptions } from "./render.js";

export type InteractiveOptions = {
  engine: RoundtableEngine;
  session: Session;
  renderOptions: RenderOptions;
  once: boolean;
};

const HELP_TEXT = `
Available commands:
  /help              Show this help message
  /exit              Exit the session
  /status            Show session status
  /transcript        Print the session transcript
  /refresh-context   Rebuild the context pack from the target folder
`;

export async function runInteractive(options: InteractiveOptions): Promise<void> {
  const { engine, session, renderOptions, once } = options;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let deliberating = false;
  let abortController: AbortController | undefined;

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    if (deliberating && abortController) {
      abortController.abort();
    } else {
      console.log("\nExiting.");
      rl.close();
      process.exit(0);
    }
  });

  const prompt = (): Promise<string | null> =>
    new Promise((resolve) => {
      rl.question("You: ", (answer) => resolve(answer));
      rl.once("close", () => resolve(null));
    });

  while (true) {
    const input = await prompt();

    // Ctrl+D / EOF
    if (input === null) {
      console.log("\nExiting.");
      break;
    }

    const trimmed = input.trim();

    // Empty input
    if (trimmed === "") continue;

    // Slash commands
    if (trimmed.startsWith("/")) {
      const command = trimmed.split(/\s+/)[0]!.toLowerCase();

      switch (command) {
        case "/exit": {
          console.log("Exiting.");
          rl.close();
          return;
        }

        case "/help": {
          console.log(HELP_TEXT);
          continue;
        }

        case "/status": {
          const { meta } = session;
          console.log(`\nSession: ${meta.id}`);
          console.log(`Status: ${meta.status}`);
          console.log(`Target: ${meta.targetPath}`);
          console.log(`Events: ${session.events.length}`);
          if (meta.latestStewardSummary) {
            console.log(`Last summary: ${meta.latestStewardSummary}`);
          }
          console.log();
          continue;
        }

        case "/transcript": {
          const md = generateTranscriptMarkdown(session.events, session.meta.id);
          console.log(md);
          continue;
        }

        case "/refresh-context": {
          console.log("Rebuilding context pack...");
          try {
            const contextPack = await buildContextPack(
              session.meta.targetPath,
              session.meta.configSnapshot.context,
            );
            await engine.refreshContext(session, contextPack);
            console.log(
              `Context refreshed: ${contextPack.stats.includedFiles} files, ${contextPack.stats.totalBytes} bytes`,
            );
          } catch (err) {
            console.error(`Failed to refresh context: ${err instanceof Error ? err.message : String(err)}`);
          }
          continue;
        }

        default: {
          console.error(`Unknown command: ${command}. Type /help for available commands.`);
          continue;
        }
      }
    }

    // Run deliberation
    deliberating = true;
    abortController = new AbortController();
    resetRenderer();

    try {
      const events = engine.submitMessage(session, trimmed, abortController.signal);
      for await (const event of events) {
        renderEvent(event, renderOptions);
      }
    } catch (err) {
      if (abortController.signal.aborted) {
        console.log("\nDeliberation aborted.");
      } else {
        console.error(`\nDeliberation error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      deliberating = false;
      abortController = undefined;
    }

    if (once) {
      rl.close();
      return;
    }
  }

  rl.close();
}

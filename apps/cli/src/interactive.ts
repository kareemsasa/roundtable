import { createInterface } from "node:readline";
import type { Session } from "@wardroom/core";
import type { WardroomEngine } from "@wardroom/core";
import { generateTranscriptMarkdown } from "@wardroom/persistence";
import { buildContextPack } from "@wardroom/context";
import { renderEvent, resetRenderer } from "./render.js";
import type { RenderOptions } from "./render.js";

export type InteractiveOptions = {
  engine: WardroomEngine;
  session: Session;
  renderOptions: RenderOptions;
  once: boolean;
};

const HELP_TEXT = `
Available commands:
  /help              Show this help message
  /exit              Exit the session
  /stop              Interrupt active deliberation
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

  // Pending resolve for the idle-mode input promise
  let lineResolve: ((line: string | null) => void) | undefined;
  // Buffer for lines that arrive between waitForInput() calls
  const lineQueue: string[] = [];

  // Continuous line listener — routes input based on state
  rl.on("line", (line: string) => {
    if (deliberating) {
      const trimmed = line.trim();
      if (trimmed === "") return;
      const cmd = trimmed.split(/\s+/)[0]!.toLowerCase();
      if (cmd === "/stop") {
        if (abortController) abortController.abort();
      } else {
        console.log("Deliberation in progress. Type /stop to interrupt.");
      }
      return;
    }

    // Idle: deliver to the waiting prompt or buffer
    if (lineResolve) {
      const resolve = lineResolve;
      lineResolve = undefined;
      resolve(line);
    } else {
      lineQueue.push(line);
    }
  });

  rl.once("close", () => {
    if (lineResolve) {
      const resolve = lineResolve;
      lineResolve = undefined;
      resolve(null);
    }
  });

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

  const waitForInput = (): Promise<string | null> =>
    new Promise((resolve) => {
      // Drain buffer first
      if (lineQueue.length > 0) {
        resolve(lineQueue.shift()!);
        return;
      }
      lineResolve = resolve;
      process.stdout.write("You: ");
    });

  while (true) {
    const input = await waitForInput();

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

        case "/stop": {
          console.log("No active deliberation to stop.");
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
            console.error(
              `Failed to refresh context: ${err instanceof Error ? err.message : String(err)}`,
            );
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

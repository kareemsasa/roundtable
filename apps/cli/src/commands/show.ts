import { Command } from "commander";
import { resolveConfig } from "@roundtable/config";
import { FileSessionStore, generateTranscriptMarkdown } from "@roundtable/persistence";

function getStore() {
  const config = resolveConfig({ env: process.env as Record<string, string> });
  return new FileSessionStore(config.dataDir);
}

export const showCommand = new Command("show")
  .description("Show session transcript")
  .argument("[session-id]", "Session ID to show")
  .option("--latest", "Show most recent session")
  .option("--regenerate", "Regenerate transcript from events")
  .action(
    async (sessionId: string | undefined, options: { latest?: boolean; regenerate?: boolean }) => {
      if (!sessionId && !options.latest) {
        console.error("Error: provide a session ID or use --latest.");
        process.exit(1);
      }

      const store = getStore();

      if (options.latest) {
        const sessions = await store.listSessions();
        if (sessions.length === 0) {
          console.error("No sessions found.");
          process.exit(1);
        }
        sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        sessionId = sessions[0].id;
      }

      try {
        const events = await store.loadEvents(sessionId!);
        const md = generateTranscriptMarkdown(events, sessionId!);
        console.log(md);
      } catch (err) {
        console.error(`Error: could not load session ${sessionId}: ${(err as Error).message}`);
        process.exit(1);
      }
    },
  );

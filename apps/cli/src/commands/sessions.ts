import { Command } from "commander";
import { resolveConfig } from "@roundtable/config";
import { FileSessionStore } from "@roundtable/persistence";

function getStore() {
  const config = resolveConfig({ env: process.env as Record<string, string> });
  return new FileSessionStore(config.dataDir);
}

export const sessionsCommand = new Command("sessions").description("Manage sessions");

sessionsCommand
  .command("list")
  .description("List past sessions")
  .action(async () => {
    const store = getStore();
    const sessions = await store.listSessions();
    if (sessions.length === 0) {
      console.log("No sessions found.");
      return;
    }
    console.log("Sessions:\n");
    for (const s of sessions) {
      const title = s.title ?? "(untitled)";
      console.log(`  ${s.id}  ${s.status.padEnd(14)} ${title}`);
      console.log(`    Target: ${s.targetPath}`);
      console.log(`    Created: ${s.createdAt}`);
      console.log();
    }
  });

sessionsCommand
  .command("archive <id>")
  .description("Archive a session")
  .action(async (id) => {
    const store = getStore();
    try {
      await store.updateMeta(id, { status: "archived", updatedAt: new Date().toISOString() });
      console.log(`Session ${id} archived.`);
    } catch (err) {
      console.error(`Error: could not archive session ${id}: ${(err as Error).message}`);
      process.exit(1);
    }
  });

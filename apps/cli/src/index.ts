#!/usr/bin/env node
import { Command } from "commander";
import { conveneCommand } from "./commands/convene.js";

const program = new Command()
  .name("roundtable")
  .description("Local-first group chat where Claude and Codex deliberate over a project folder")
  .version("0.0.1");

program.addCommand(conveneCommand);

// Placeholder commands for sessions, show, config
program
  .command("sessions")
  .description("Manage sessions (not yet implemented)")
  .action(() => {
    console.log("Not yet implemented. Coming in the next milestone.");
  });

program
  .command("show")
  .description("Show session transcript (not yet implemented)")
  .action(() => {
    console.log("Not yet implemented. Coming in the next milestone.");
  });

program
  .command("config")
  .description("Manage configuration (not yet implemented)")
  .action(() => {
    console.log("Not yet implemented. Coming in the next milestone.");
  });

program.parse();

#!/usr/bin/env node
import { Command } from "commander";
import { conveneCommand } from "./commands/convene.js";
import { sessionsCommand } from "./commands/sessions.js";
import { showCommand } from "./commands/show.js";
import { configCommand } from "./commands/config.js";

const program = new Command()
  .name("roundtable")
  .description("Local-first group chat where Claude and Codex deliberate over a project folder")
  .version("0.0.1");

program.addCommand(conveneCommand);
program.addCommand(sessionsCommand);
program.addCommand(showCommand);
program.addCommand(configCommand);

program.parse();

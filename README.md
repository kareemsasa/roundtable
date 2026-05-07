# Roundtable

Local-first persistent group chat where Claude and Codex deliberate over a project folder.

## Status

v1 in development. Not yet usable.

## What It Does

You point Roundtable at a folder and ask a question. Claude and Codex respond to you and each other. A moderator (the Steward) summarizes when the room reaches consensus or a useful decision point.

## v1 Scope

- CLI-first (interactive terminal app)
- Read-only: never modifies the target project
- Participants: User, Claude, Codex, Steward
- Curated context packs (not ambient folder access)
- Persistent sessions (JSONL event log)
- Claude and Codex integrated via CLI child processes

## v1 Non-Goals

- No file writes to target projects
- No arbitrary command execution
- No OS-level sandboxing (planned for later)
- No web UI (planned for later)
- No custom/pluggable agents

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Architecture

See `docs/superpowers/specs/2026-05-06-roundtable-v1-design.md` for the full design spec.

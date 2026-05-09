# Roundtable

## Project

Local-first CLI group chat for AI deliberation. Claude and Codex respond to user messages about a target folder, moderated by a Steward.

## Tech Stack

- TypeScript, Node.js 20+, pnpm workspaces
- Zod for runtime validation
- Vitest for tests
- Commander for CLI

## Structure

- `apps/cli` — CLI entry point, composition root
- `packages/core` — types, schemas, turn loop, engine
- `packages/config` — config schema, loading, defaults
- `packages/persistence` — JSONL event store, session management
- `packages/context` — folder scanning, context pack builder
- `packages/adapters` — mock and real CLI process adapters

## Local Setup

After cloning, run `pnpm install` — this installs dependencies and sets up the pre-commit hook (Prettier via `simple-git-hooks` + `lint-staged`).

## Conventions

- ESM only (`"type": "module"`)
- Strict TypeScript
- Tests colocated in `src/__tests__/`
- Zod schemas for all runtime boundaries (JSONL, config, CLI output parsing)
- `@roundtable/*` package scope

## Key Design Decisions

- Claude/Codex integrated via CLI child processes, NOT API SDKs
- App owns the turn loop; Steward is advisory only
- Event-sourced sessions: `events.jsonl` is the source of truth
- Context packs are curated snapshots, not ambient folder access
- Adapters never receive the target folder path as cwd
- Read-only by design (not by kernel enforcement) in v1

## Spec

Full design: `docs/superpowers/specs/2026-05-06-roundtable-v1-design.md`

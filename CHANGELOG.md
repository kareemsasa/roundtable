# Changelog

## v0.1.9 — 2026-05-09

- Set default `maxTranscriptBytes` to 131,072 (128 KiB)
- Prevents unbounded transcript growth in long sessions
- Recent messages preserved; older messages omitted with clear notice
- 325 tests

## v0.1.8 — 2026-05-09

- Derive session titles from the first user message
- Truncate at word boundary around 80 characters
- Preserve existing titles on resumed sessions
- `sessions list` now shows meaningful titles instead of `(untitled)`
- 324 tests

## v0.1.7 — 2026-05-09

- Surface `output_truncated` warnings on stderr with participant, stream, and byte counts
- Warning renders in both streaming and `--no-stream` modes
- 314 tests

## v0.1.6 — 2026-05-09

- Ensure sessions return to `awaiting_user` after aborts, adapter errors, and persistence failures
- Persist best-effort `deliberation_interrupted` events on engine errors
- Treat artifact and steward summary persistence as non-fatal
- 309 tests

## v0.1.5 — 2026-05-09

- Keep decision/history docs below implementation source in context selection
- Increase default context budget to 140 KB

## v0.1.4 — 2026-05-09

- Stream Claude output via JSONL partial message events
- Keep Codex display-buffered (its CLI emits only completed items)
- Keep Steward buffered for structured decision parsing
- Strip duplicate Codex self-labels from final output
- 303 tests

## v0.1.3 — 2026-05-08

- Persist invocation artifacts (meta.json, stdout.log, stderr.log)
- Add pre-commit formatting hook (Prettier via simple-git-hooks)
- Remove core/adapters workspace dependency cycle
- Record Wardroom as chosen future rename (deferred)

## v0.1.2 — 2026-05-08

- Exclude Claude worktrees and TypeScript build artifacts from context packs
- Prioritize implementation source over historical docs, fixtures, tests
- Increase default context budget to 128 KB

## v0.1.1 — 2026-05-08

- Remove Claude `--bare` flag so authenticated CLI sessions work
- Suppress raw Codex JSONL provider events in normal chat display
- Hide raw steward JSON from transcripts and live output
- 244 tests

## v0.1.0 — 2026-05-07

Initial release. CLI-first AI deliberation over project folders.

- Interactive group chat with Claude, Codex, and Steward moderator
- Curated context packs with priority ranking and secret redaction
- Event-sourced persistent sessions (JSONL)
- YAML config files (project-local and user-global)
- Read-only by design: never modifies target projects
- Mock and dry-run modes
- 240 tests across 6 packages

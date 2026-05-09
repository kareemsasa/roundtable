# Roundtable

Local-first persistent group chat where Claude and Codex deliberate over a project folder.

> **Note:** This is an independent, open-source, local-first developer tool. It is not affiliated with [roundtable.now](https://roundtable.now) or any other similarly named AI council/debate products. This project focuses on CLI-driven, artifact-backed deliberation over local codebases — not hosted multi-model brainstorming SaaS. A rename may be forthcoming before public release.

## What It Does

You point Roundtable at a folder and ask a question. Claude and Codex respond to you and each other. A moderator called the Steward summarizes when the room reaches consensus or a useful decision point.

```
$ roundtable convene ~/code/my-project "Should we refactor the auth module?"

Building context pack... done (32 files, 78KB)
Session rt_abc123 started

You: Should we refactor the auth module?

Claude: The auth module has grown complex. I'd suggest an adapter pattern
to isolate the token storage from the session handling...

Codex: Agreed on the complexity. I'd start with the session handler since
it has the most coupling to the rest of the codebase...

Steward: Both participants agree the auth module should be refactored.
Claude suggests an adapter pattern, Codex recommends starting with the
session handler. The key decision is whether to refactor incrementally
or replace wholesale.
```

## Quickstart

```bash
# Clone and install
git clone <repo-url> roundtable
cd roundtable
pnpm install
pnpm build

# Run with mock adapters (no auth required)
pnpm roundtable convene ./fixtures/sample-project "What should I work on?" --once --mock

# Preview what context would be sent (no session, no invocations)
pnpm roundtable convene ./fixtures/sample-project --dry-run

# Run with real Claude + Codex (requires auth)
pnpm roundtable convene ~/code/my-project "Should we refactor this?"
```

### Real Mode Requirements

Real mode invokes Claude and Codex via their CLI commands:

- **Claude CLI**: Install from [claude.ai](https://claude.ai), authenticate with `claude auth`
- **Codex CLI**: Install from [openai.com](https://openai.com), authenticate with `codex login`

If either CLI is missing, Roundtable shows an actionable error with install instructions. Use `--mock` to test without authentication.

## Commands

### `convene` - Start a deliberation

```bash
# New session on a folder
roundtable convene <path> [message]

# Resume an existing session
roundtable convene --session <id> [message]
```

**Flags:**

| Flag                   | Description                               |
| ---------------------- | ----------------------------------------- |
| `--mock`               | Use mock adapters (no auth required)      |
| `--once`               | Run one deliberation and exit             |
| `--dry-run`            | Preview context pack without invoking     |
| `--session <id>`       | Resume an existing session                |
| `--max-rounds <n>`     | Max deliberation rounds (default: 2)      |
| `--context-budget <n>` | Context budget in bytes (default: 100000) |
| `--max-files <n>`      | Max files in context pack (default: 50)   |
| `--include <glob>`     | Include file pattern (repeatable)         |
| `--exclude <glob>`     | Exclude file pattern (repeatable)         |
| `--no-stream`          | Wait for full responses                   |
| `--timeout <ms>`       | Per-participant timeout                   |
| `--verbose`            | Show invocation metadata                  |

**Interactive commands** (during a session):

| Command            | Action                             |
| ------------------ | ---------------------------------- |
| `/help`            | Show available commands            |
| `/exit`            | Leave the room (session preserved) |
| `/stop`            | Interrupt active deliberation      |
| `/status`          | Show session info                  |
| `/refresh-context` | Rebuild context pack               |
| `/transcript`      | Display session transcript         |

### `sessions` - Manage sessions

```bash
roundtable sessions list
roundtable sessions archive <id>
```

### `show` - View session transcript

```bash
roundtable show <session-id>
roundtable show --latest
```

### `config` - Configuration

```bash
roundtable config show        # Show resolved config
roundtable config init        # Generate roundtable.config.yaml template
```

## Configuration

Config is resolved in this order (later overrides earlier):

1. Built-in defaults
2. `~/.config/roundtable/config.yaml` (user-global)
3. `roundtable.config.yaml` or `.roundtable/config.yaml` (project-local)
4. CLI flags

Generate a starter config with `roundtable config init`:

```yaml
context:
  budgetBytes: 100000
  maxFiles: 50
  maxFileBytes: 10000

deliberation:
  maxRounds: 2
  participantTimeoutMs: 120000

adapters:
  claude:
    command: claude # path to Claude CLI
  codex:
    command: codex # path to Codex CLI
```

Set `ROUNDTABLE_HOME` to override the default data directory (`~/.local/share/roundtable`).

## How It Works

### Context Pack

Roundtable builds a curated snapshot of the target folder — not ambient filesystem access. Files are selected by priority within a byte budget:

1. `ROUNDTABLE.md`, `COUNCIL.md` (project-specific context)
2. `AGENTS.md`, `CLAUDE.md` (agent configs)
3. Git summary (branch, recent commits, status)
4. `README.md`, `package.json`, `tsconfig.json` (project metadata)
5. `docker-compose.yml`, CI configs (infrastructure)
6. `docs/**/*.md` (documentation)
7. Source files (entry points, recently modified)

Secret files (`.env`, `*.pem`, `*.key`, `credentials.*`) are hard-denied. A redaction pass scans included files for leaked API keys, private key blocks, and bearer tokens.

### Turn Loop

Each deliberation follows a fixed round-robin:

```
User message
  -> Claude responds (sees context pack + full transcript)
  -> Codex responds (sees context pack + full transcript including Claude)
  -> Steward evaluates (sees full transcript)
     -> "concluded": emit summary, return to prompt
     -> "continue": another round (up to max)
     -> "needs_user": return to prompt for clarification
```

Hard caps prevent runaway loops (max 2 rounds by default, configurable).

### Persistence

Sessions are stored as directories under `~/.local/share/roundtable/sessions/`:

```
<session-id>/
  meta.json          # session metadata
  events.jsonl       # append-only event log (source of truth)
  context-packs/     # frozen context snapshots
  transcript.md      # derived, regenerable
  artifacts/         # raw CLI stdout/stderr per invocation
```

## Security Model

**v1 is read-only by design, not by kernel enforcement.**

- Roundtable reads the target folder to build a context pack, then never touches it again
- Claude and Codex are invoked in the lowest-permission modes their CLIs support:
  - Claude: `--permission-mode plan --tools ""`
  - Codex: `--sandbox read-only`
- Adapters spawn processes in a temp directory, not the target folder
- System prompts explicitly forbid writes, command execution, and mutations
- Session data is written only to Roundtable's own data directory
- No OS-level sandboxing in v1 (planned for later)

## v1 Non-Goals

- No file writes to target projects
- No arbitrary command execution against target projects
- No OS-level sandboxing (planned)
- No web UI (planned)
- No custom/pluggable agents
- No Steward permission escalation

## Known Limitations (v1)

- **No OS-level sandboxing** — read-only by design, not by kernel enforcement
- **Buffered streaming** — CLI output is collected per invocation, not streamed token-by-token in real time
- **Simple transcript truncation** — long sessions are trimmed with a notice, not summarized intelligently
- **Codex system prompt is embedded in user prompt** — `codex exec` has no `--system-prompt` flag

## Local Install

**From the repo (recommended for development):**

```bash
pnpm install && pnpm build
pnpm roundtable convene ./my-project "question"
```

**Direct execution (after build):**

```bash
node apps/cli/dist/index.js convene ./my-project "question"
```

**Global link (requires PNPM_HOME):**

```bash
cd apps/cli && pnpm link --global
roundtable convene ./my-project "question"
```

## Development

```bash
pnpm install       # install dependencies
pnpm build         # compile all packages
pnpm test          # run test suite (240 tests)
pnpm lint          # lint
pnpm format:check  # check formatting
```

### Project Structure

```
apps/cli/           CLI entry point, composition root
packages/core/      Types, schemas, turn loop, engine
packages/config/    Config schema, loading, defaults
packages/persistence/  JSONL event store, session management
packages/context/   Folder scanning, context pack builder
packages/adapters/  Mock and real CLI process adapters
```

## Architecture

See `docs/superpowers/specs/2026-05-06-roundtable-v1-design.md` for the full design spec.

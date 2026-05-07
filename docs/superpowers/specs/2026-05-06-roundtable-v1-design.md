# Roundtable v1 Design Spec

**Date:** 2026-05-06
**Status:** Draft
**Scope:** v1 MVP — CLI-first local group chat for AI deliberation over a project folder

---

## 1. Product Overview

Roundtable is a local-first persistent group chat where Claude and Codex deliberate over a user-provided folder path. The user submits a message, Claude and Codex respond to the user and each other, and a moderator called the Steward summarizes once the room reaches consensus or a useful decision point.

### v1 Participants

- **User** — submits messages, reads responses, can interrupt
- **Claude** — responds via Claude CLI child process
- **Codex** — responds via Codex CLI child process
- **Steward** — separate Claude CLI invocation with moderator system prompt
- **Roundtable** — system participant for visible errors and engine notices

### v1 Non-Goals

- No file writes to the target project
- No kctl execution
- No vault writes
- No Service Hub mutation
- No arbitrary shell command execution
- No OS-level sandboxing (future hardening)
- No custom/pluggable agents
- No direct Anthropic/OpenAI API SDK usage — integration is via CLI child processes

---

## 2. Tech Stack

| Choice | Rationale |
|---|---|
| TypeScript | Shared language for CLI + future web UI |
| Node.js | Default runtime for v1 |
| pnpm | Workspace-based monorepo management |
| Zod | Runtime validation for events, config, Steward output |
| Vitest | Test runner |

Claude and Codex are integrated through their CLI commands as child processes, not through API SDKs. This means the architecture prioritizes process lifecycle management, stdout/stderr parsing, and adapter interfaces over HTTP client configuration.

---

## 3. Monorepo Structure

```
apps/
  cli/                          # CLI entry point, composition root
    src/
      index.ts
      commands/
        convene.ts
        sessions.ts
        show.ts
        config.ts

packages/
  core/                         # Turn loop, state machine, types, interfaces
    src/
      types.ts
      turn-loop.ts
      steward.ts
      session.ts

  context/                      # Folder scanner, context pack builder
    src/
      build-context-pack.ts
      scan-folder.ts
      file-selection.ts
      redaction.ts

  adapters/                     # Claude/Codex/Steward CLI process adapters
    src/
      cli-agent.ts
      claude.ts
      codex.ts
      steward-claude.ts
      mock.ts                   # Mock adapters for testing

  persistence/                  # Session store, JSONL, markdown export
    src/
      session-store.ts
      jsonl.ts
      markdown-export.ts
      paths.ts

  config/                       # Config loading, schema, resolution
    src/
      load-config.ts
      schema.ts

docs/
  product-spec.md
  architecture.md
  security-model.md
  milestones.md
```

### Package dependency graph

```
apps/cli
  ├── packages/core
  ├── packages/context
  ├── packages/persistence
  ├── packages/config
  └── packages/adapters
```

- `core` defines interfaces and owns the turn loop / state machine
- `adapters` implements `AgentAdapter` (core never depends on concrete adapters)
- `apps/cli` is the composition root that wires concrete implementations into the core runtime

---

## 4. Data Model

### 4.1 Event System

Every state change is persisted as a typed event in `events.jsonl`. The event log is the durable source of truth.

#### Event types

```ts
type EventType =
  | "user_message"
  | "deliberation_started"
  | "agent_invocation_started"
  | "agent_invocation_metadata"
  | "agent_chunk"
  | "agent_response_end"
  | "agent_error"
  | "agent_invocation_timeout"
  | "output_truncated"
  | "steward_decision"
  | "steward_parse_error"
  | "deliberation_ended"
  | "deliberation_interrupted"
  | "context_pack_built"
  | "session_started"
  | "session_archived"
  | "engine_state_changed";
```

#### Base event shape

```ts
type SessionEvent = {
  id: string;                    // unique event id
  type: EventType;
  timestamp: string;             // ISO 8601
  sessionId: string;
  deliberationId?: string;
  contextPackId?: string;
  participant?: TranscriptParticipant;
  data: Record<string, unknown>; // generic at storage boundary
};
```

At the storage boundary (JSONL), `data` is `Record<string, unknown>`. Internally, discriminated union types enforce payload shapes per event type, validated by Zod schemas.

#### Key event payloads

| Event type | `data` shape |
|---|---|
| `user_message` | `{ content: string }` |
| `agent_invocation_started` | `{ invocationId: string, command: string, pid: number }` |
| `agent_invocation_metadata` | `{ cwd: string, command: string, args: string[], envKeys: string[] }` |
| `agent_chunk` | `{ content: string, stream: "stdout" \| "stderr" }` |
| `agent_response_end` | `{ content: string, durationMs: number, exitCode: number }` |
| `agent_error` | `{ error: string, stderr?: string, exitCode?: number }` |
| `agent_invocation_timeout` | `{ durationMs: number, killed: boolean }` |
| `output_truncated` | `{ stream: "stdout", originalBytes: number, keptBytes: number }` |
| `steward_decision` | `StewardDecision` |
| `steward_parse_error` | `{ rawText: string, parseError: string }` |
| `context_pack_built` | `{ contextPackId: string, version: number, fileCount: number, totalBytes: number }` |
| `engine_state_changed` | `{ from: string, to: string, reason: string }` |
| `deliberation_interrupted` | `{ reason: "user_stop" \| "timeout" \| "double_failure" }` |

#### Event ordering

Events are ordered causally. A user message precedes and triggers a deliberation:

```
user_message
deliberation_started          (references userMessageEventId)
agent_invocation_started
agent_chunk...
agent_response_end
...
steward_decision
deliberation_ended
```

### 4.2 Steward Decision

```ts
type StewardDecision = {
  status: "concluded" | "continue" | "needs_user";
  reason: string;
  summary: string;
  decisionPoint?: string;
  recommendedActions?: string[];
  nextSpeakerHint?: "claude" | "codex";  // optional, ignored in v1
};
```

Validated by Zod schema. If parse fails: emit `steward_parse_error`, create a visible Roundtable error message, use raw text as untrusted summary, conclude deliberation safely. Invalid structured output is never treated as authoritative.

### 4.3 Session Model

```ts
type SessionRuntimeState =
  | "awaiting_user"
  | "deliberating"
  | "archived"
  | "error";

type SessionMeta = {
  id: string;
  status: SessionRuntimeState;
  title?: string;
  targetPath: string;
  createdAt: string;
  updatedAt: string;
  currentContextPackId: string;
  configSnapshot: ResolvedConfig;
  participants: ParticipantConfig[];
  latestStewardSummary?: string;
};
```

`meta.json` is mutable for convenience fields (`updatedAt`, `title`, `latestStewardSummary`). `events.jsonl` remains the durable source of truth.

### 4.4 Deliberation Model

A deliberation is one user message and the resulting turn loop. It begins after the user speaks — `awaiting_user` is a session state, not a deliberation state.

```ts
type DeliberationState =
  | "started"
  | "invoking_claude"
  | "invoking_codex"
  | "invoking_steward"
  | "concluded"
  | "error";

type Deliberation = {
  id: string;
  contextPackId: string;
  round: number;
  maxRounds: number;
  state: DeliberationState;
};
```

### 4.5 Transcript Participant

```ts
type TranscriptParticipant =
  | "user"
  | "claude"
  | "codex"
  | "steward"
  | "roundtable";
```

`"roundtable"` is used for system-visible errors and engine notices (e.g., "Codex failed to respond: invocation timed out after 120s.").

### 4.6 Session Directory Layout

```
~/.local/share/roundtable/sessions/<session-id>/
  meta.json                        # mutable convenience state
  events.jsonl                     # append-only source of truth
  context-packs/
    <contextPackId>.json           # structured context snapshot
    <contextPackId>.md             # human-readable context snapshot
  transcript.md                    # derived, regenerable
  steward-summary.md               # derived, latest
  artifacts/
    claude/
      <invocationId>.stdout.log
      <invocationId>.stderr.log
      <invocationId>.meta.json
    codex/
      ...
    steward/
      ...
```

**Source of truth:** `meta.json` + `events.jsonl` + `context-packs/<id>.json`. All markdown files are derived and can be regenerated from these.

**Storage location:** `~/.local/share/roundtable/` by default (XDG convention). Override with `ROUNDTABLE_HOME` env var or config.

**Artifacts privacy:** Artifacts may contain model output derived from private project context. They are private local app data — never auto-exported, committed, or synced.

---

## 5. Adapter Interface & Process Model

### 5.1 AgentAdapter Interface

```ts
interface AgentAdapter {
  id: string;                        // "claude" | "codex" | "steward"
  invoke(
    input: AgentInput,
    signal?: AbortSignal
  ): AsyncIterable<AgentEvent>;
}

type AgentInput = {
  invocationId: string;              // stable ID for correlating events/artifacts
  contextPack: ContextPack;
  transcript: TranscriptMessage[];
  systemPrompt: string;
  deliberationId: string;
};

type TranscriptMessage = {
  participant: TranscriptParticipant;
  content: string;
  timestamp: string;
};
```

### 5.2 AgentEvent Discriminated Union

```ts
type AgentEvent =
  | { type: "invocation_started"; command: string; pid: number; timestamp: string }
  | { type: "invocation_metadata"; cwd: string; command: string; args: string[]; envKeys: string[] }
  | { type: "chunk"; content: string; stream: "stdout" | "stderr" }
  | { type: "response_end"; content: string; durationMs: number; exitCode: number }
  | { type: "error"; error: string; stderr?: string; exitCode?: number }
  | { type: "timeout"; durationMs: number; killed: boolean }
  | { type: "output_truncated"; stream: "stdout"; originalBytes: number; keptBytes: number };
```

The turn loop uses `response_end`, `error`, and `timeout` for state transitions. `chunk` drives streaming display. `invocation_started` and `invocation_metadata` go to the event log and artifacts for debugging.

### 5.3 Process Lifecycle

```
invoke() called
  -> create temp cwd: ~/.local/share/roundtable/tmp/<invocationId>/
  -> spawn child process (spawn, not shell) with read-only flags
  -> emit invocation_started
  -> emit invocation_metadata (envKeys only, no values)
  -> stream stdout as chunk events
  -> capture stderr as chunk events (stream: "stderr")
  -> on process exit:
     -> if exit 0: parse final output, emit response_end
     -> if exit non-0: emit error with stderr
  -> if output exceeds maxOutputBytes: emit output_truncated
  -> if AbortSignal fires: SIGTERM -> grace period -> SIGKILL -> emit timeout
  -> write stdout/stderr to artifacts/<participant>/<invocationId>.{stdout,stderr}.log
  -> clean up temp cwd (unless debug retention enabled)
```

### 5.4 Adapter Isolation Rules

- Adapters never receive the raw target folder path as cwd or argument
- Adapters spawn processes with `cwd` set to a Roundtable-owned temp directory
- Adapters use `spawn(command, args)`, never shell string execution (reduces injection risk)
- Adapters use the lowest-permission CLI flags available
- Adapters do not pass flags that bypass sandboxing, approval prompts, or permission checks
- Context is passed exclusively through the curated context pack
- All stdout/stderr is captured — no ambient terminal passthrough
- Environment variables are never persisted (only key names logged)

### 5.5 Adapter Mode

```ts
type AdapterMode = "read_only" | "mock";
```

v1 supports `read_only` (real CLI) and `mock` (deterministic test responses). Future modes: `verify`, `worktree_write`.

### 5.6 Adapter Limits

```ts
type AdapterLimits = {
  invocationTimeoutMs: number;     // default: 120_000
  maxOutputBytes: number;          // default: 512_000
  gracefulShutdownMs: number;      // default: 5_000
};
```

### 5.7 Adapter Configuration

```yaml
adapters:
  claude:
    command: claude
    mode: read_only
  codex:
    command: codex
    mode: read_only
  steward:
    command: claude
    mode: read_only
```

Supports configurable binary paths for CLI detection and non-standard installs.

### 5.8 How Input Reaches the CLI

Each adapter translates `AgentInput` into its CLI's expected format. The exact invocation details (flags, stdin vs. args, prompt format) will be pinned during implementation when tested against actual installed CLI versions.

Adapters should disable shell/tool execution features wherever supported by the provider CLI.

---

## 6. Context Pack Builder

### 6.1 ContextPack Type

```ts
type ContextPack = {
  id: string;
  version: number;
  targetPath: string;                // metadata only, not an access grant
  displayPath: string;               // redacted path for prompts
  createdAt: string;
  config: ContextConfig;
  tree: DirectoryTree;
  files: ContextFile[];
  gitSummary?: GitSummary;
  omitted: OmittedReport;
  stats: {
    totalFiles: number;
    includedFiles: number;
    totalBytes: number;
    budgetBytes: number;
  };
};

type ContextFile = {
  path: string;                      // relative to targetPath
  category: FileCategory;
  content: string;
  bytes: number;
  truncated: boolean;
};

type FileCategory =
  | "roundtable_config"
  | "agent_config"
  | "project_meta"
  | "documentation"
  | "source"
  | "config"
  | "other";
```

### 6.2 File Selection Priority

Files are selected in this order within the context budget:

1. **Roundtable-specific**: `ROUNDTABLE.md`, `COUNCIL.md`
2. **Agent configs**: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`
3. **Git summary**: branch, recent log (last 20 commits), status
4. **Project meta**: `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `Cargo.toml`, `go.mod`, etc.
5. **Infrastructure**: `docker-compose.yml`, `Dockerfile`, CI configs
6. **Documentation**: `docs/**/*.md`
7. **Source files**: selected conservatively — entry points, recently modified files, files referenced in README/docs, package exports/bin targets

### 6.3 Default Exclusions

- `.git/` internals (git metadata obtained via commands)
- `node_modules/`, `vendor/`, dependency directories
- Build output: `dist/`, `build/`, `.next/`, `target/`
- Caches: `.cache/`, `__pycache__/`, `.turbo/`
- Large lock files (existence noted in omitted report)
- Large binaries, images, videos, compiled assets

### 6.4 Hard-Deny List (not bypassable by includes in v1)

- `.env*`
- `*.pem`, `*.key`
- `credentials.*`
- `id_rsa*`
- Database files
- Binary/media files

A future `--unsafe` flag may relax hard-deny rules, but v1 refuses.

### 6.5 Redaction Pass

After file selection, a redaction pass scans for:

- API key patterns
- Private key blocks (`-----BEGIN ... PRIVATE KEY-----`)
- Bearer tokens
- Common secret assignment patterns (`API_KEY=`, `SECRET=`, etc.)

This is defense-in-depth, not a replacement for exclusion rules.

### 6.6 Budget Enforcement

```ts
type ContextConfig = {
  budgetBytes: number;             // default: 100_000
  maxFiles: number;                // default: 50
  maxFileBytes: number;            // default: 10_000 per file
  maxTreeDepth: number;            // default: 5
  includes?: string[];
  excludes?: string[];
};
```

Files are selected in priority order until the budget is exhausted. Truncated files include a marker. The omitted report includes budget exhaustion as a reason.

### 6.7 Omitted Report

```ts
type OmittedReport = {
  categories: { category: string; count: number; reason: string }[];
  files: { path: string; reason: string }[];
};
```

Reasons include: `"excluded_pattern"`, `"hard_denied"`, `"budget_exhausted"`, `"over_size_limit"`, `"binary_file"`.

Lock file example: `pnpm-lock.yaml omitted: lock file over size threshold`.

### 6.8 Config Resolution

Resolved in this order (later overrides earlier):

1. Built-in defaults
2. `~/.config/roundtable/config.yaml` (user-global)
3. `roundtable.config.yaml` or `.roundtable/config.yaml` in target folder (project-local)
4. CLI flags (`--include`, `--exclude`, `--context-budget`, `--max-files`)

### 6.9 Markdown Rendering

The generated markdown includes epistemic boundary framing:

```markdown
# Context Pack

This is a curated, bounded snapshot of the target folder. It is not
the full repository. Files were selected by priority within a budget.
Omitted files are listed below.

## Target
service-hub

## Included
...

## Omitted
...

## Git Summary
...
```

Prompts use display paths (e.g., `~/code/personal/service-hub`), not raw absolute paths. The structured JSON retains the absolute path for internal bookkeeping.

### 6.10 Context Pack Lifecycle

- Built at session start as version 1
- Stored as `context-packs/<contextPackId>.json` and `<contextPackId>.md`
- Each deliberation records its `contextPackId`
- `/refresh-context` rebuilds and stores a new version
- v1 implements `/refresh-context` — the operation is simple (rebuild + store + update meta) and useful for interactive sessions

---

## 7. Turn Loop & Session Engine

### 7.1 State Machine

```
Session lifecycle:
  awaiting_user <-> deliberating -> archived
                                 -> error

Deliberation lifecycle (exists only while session is "deliberating"):
  started -> invoking_claude -> invoking_codex -> invoking_steward
    -> on steward "continue" + round < maxRounds: invoking_claude (next round)
    -> on steward "concluded" or "needs_user": concluded
    -> on max rounds reached: concluded (forced)
    -> on timeout or fatal error: error
    -> on user interrupt: concluded (interrupted)
    -> on double failure (both Claude + Codex fail): concluded (skip to summary)
```

### 7.2 Core Orchestrator

```ts
interface RoundtableEngine {
  startSession(targetPath: string, config: ResolvedConfig): Promise<Session>;
  resumeSession(sessionId: string): Promise<Session>;
  submitMessage(
    session: Session,
    message: string,
    signal?: AbortSignal
  ): AsyncIterable<SessionEvent>;
  refreshContext(session: Session): Promise<ContextPack>;
  archiveSession(session: Session): Promise<void>;
}
```

### 7.3 Deliberation Flow

```
1. Emit user_message event
2. Create deliberation (id, contextPackId, round=1)
3. Emit deliberation_started (references userMessageEventId)
4. Enter turn loop:
   a. Set state -> invoking_claude
      - Build AgentInput (invocationId, contextPack, transcript, system prompt)
      - Call claude adapter.invoke()
      - Stream chunks as events (display + artifacts)
      - On response_end: append to transcript, emit event
      - On error/timeout: emit visible Roundtable error message, continue to next
   b. Set state -> invoking_codex
      - Same as above with codex adapter
      - Transcript includes Claude's response (or failure notice)
      - If both Claude and Codex failed: skip Steward, conclude with failure summary
   c. Set state -> invoking_steward
      - Build AgentInput with steward system prompt
      - Call steward adapter.invoke()
      - Parse + validate StewardDecision via Zod
      - If parse fails: emit steward_parse_error, visible error, conclude safely
      - Emit steward_decision event
   d. Evaluate steward decision:
      - "concluded" -> break loop
      - "needs_user" -> break loop
      - "continue" + round < maxRounds -> round++, go to 4a
      - "continue" + round >= maxRounds -> forced conclusion, break loop
5. Set state -> concluded
6. Emit deliberation_ended event
7. Update meta.json (updatedAt, latestStewardSummary)
8. Generate/update derived markdown files (best-effort, failure doesn't block)
9. Return session to awaiting_user
```

### 7.4 Hard Caps (enforced by engine, not Steward)

```ts
type DeliberationLimits = {
  maxRounds: number;                 // default: 2
  participantTimeoutMs: number;      // default: 120_000
  deliberationTimeoutMs: number;     // default: 600_000
  maxTranscriptBytes?: number;       // budget for transcript passed to adapters
};
```

Non-negotiable. A Steward "continue" at `round === maxRounds` is overridden with a forced conclusion event.

### 7.5 Transcript Construction

```ts
function buildTranscript(events: SessionEvent[]): TranscriptMessage[] {
  return events
    .filter(e =>
      e.type === "user_message" ||
      e.type === "agent_response_end" ||
      e.type === "steward_decision" ||
      (e.type === "agent_error" && e.participant) // visible failures
    )
    .map(e => ({
      participant: e.participant!,
      content: extractDisplayContent(e),
      timestamp: e.timestamp,
    }));
}
```

Only display-level events enter the transcript. Steward decisions are rendered as readable summaries, not raw JSON.

Adapter failures appear as Roundtable messages so other participants know what happened:

```
Roundtable: Claude failed to respond: invocation timed out after 120 seconds.
```

### 7.6 Transcript Budget

Full session transcript is passed to adapters until it exceeds a budget. Then:

- Include recent messages verbatim
- Include latest Steward summary
- Omit older details with a clear notice

Later: proper session summarization.

### 7.7 Error Recovery

- Adapter failure: emit visible chat error, log to artifacts, continue to next participant
- Steward parse failure: emit error, use raw text as untrusted summary, conclude safely
- Double failure (both Claude + Codex): skip Steward or invoke only to summarize failure, do not continue another round
- Session is never destroyed by errors — failed invocations are events, not crashes
- Derived markdown generation failures do not block session validity

### 7.8 User Interrupt

Ctrl+C or `/stop` during a deliberation:

1. Signal abort on current adapter invocation
2. Adapter sends SIGTERM -> grace period -> SIGKILL
3. Emit `deliberation_interrupted` with reason `"user_stop"`
4. Return session to `awaiting_user`

The session survives interruption.

---

## 8. CLI Application

### 8.1 Command Structure

```
roundtable convene <path> [message]    Start a new deliberation
roundtable convene --session <id> [message]  Resume an existing session
roundtable sessions list               List past sessions
roundtable sessions archive <id>       Archive a session
roundtable show <session-id>           Show session transcript
roundtable show --latest               Show most recent session
roundtable config show                 Show resolved config
roundtable config init                 Generate config template
```

`--session <id>` and `<path>` are mutually exclusive. The CLI rejects ambiguous usage.

### 8.2 `convene` Flags

```
--session <id>          Resume existing session (path not required)
--once                  Run one deliberation and exit
--max-rounds <n>        Override max deliberation rounds (default: 2)
--context-budget <n>    Override context budget in bytes
--max-files <n>         Override max files in context pack
--include <glob>        Add include pattern (repeatable)
--exclude <glob>        Add exclude pattern (repeatable)
--no-stream             Wait for full responses instead of streaming
--timeout <ms>          Per-participant timeout
--verbose               Show invocation metadata and debug events
--dry-run               Build context pack preview, don't invoke or create session
```

### 8.3 Interactive Mode

Default. After the Steward concludes a deliberation, the CLI stays open for the next message.

```
$ roundtable convene ~/code/personal/service-hub

Building context pack... done (32 files, 78KB)
Session rt_01J... started

You: Should we refactor the auth middleware?

Claude:
[streaming response...]

Codex:
[streaming response...]

Steward:
The participants agree that the auth middleware should be refactored...

You: _
```

If no message is provided, enter the room and wait at `You:`.

If a message is provided, run the first deliberation immediately, then stay in interactive mode (unless `--once`).

### 8.4 Slash Commands

- `/exit` — leave the room (does not archive the session)
- `/stop` — interrupt current deliberation, stay in session
- `/status` — show session info (id, rounds, context pack version)
- `/refresh-context` — rebuild context pack (builds new version, updates session)
- `/transcript` — regenerate and display transcript
- `/help` — show available commands

Ctrl+C and Ctrl+D behave as `/exit`.

### 8.5 Display Rendering

Participant headers are minimal:

```
You
Claude
Codex
Steward
Roundtable
```

`Roundtable` is used for system-visible errors:

```
Roundtable: Codex failed to respond: invocation timed out after 120s.
```

In `--verbose` mode, invocation metadata appears as dim annotations.

### 8.6 Streaming

Adapter stdout/stderr flows through the event pipeline:

```
adapter stdout/stderr -> AgentEvent chunks -> engine events -> CLI renderer
```

Not raw passthrough. This keeps display independent from provider quirks and ensures persistence/truncation work correctly.

`--no-stream` buffers each participant's full response before rendering.

### 8.7 `--dry-run`

Builds context pack preview without creating a session or invoking adapters.

```
$ roundtable convene ~/code/personal/service-hub --dry-run

Context pack built:
  Target: service-hub
  Files: 32 included, 847 omitted
  Size: 78,204 bytes (budget: 100,000)

Included files:
  [roundtable_config] ROUNDTABLE.md (2.1KB)
  ...

Omitted categories:
  node_modules: 412 files (dependency directory)
  ...

Hard-denied:
  .env.local (secret file)

Would invoke: Claude, Codex, Steward
```

`--dry-run --save` can optionally persist the context pack.

### 8.8 Session Resumption

`--session <id>` loads the session, replays `events.jsonl` to reconstruct state, displays the last Steward summary as context, and enters interactive mode.

No auto-resume: starting `convene` with the same path always creates a new session unless `--session` is explicit.

### 8.9 Composition Root

```ts
// apps/cli/src/index.ts
const config = loadConfig(cliFlags);
const store = new FileSessionStore(config.dataDir);
const adapters = {
  claude: new ClaudeAdapter(config.adapters.claude),
  codex: new CodexAdapter(config.adapters.codex),
  steward: new StewardAdapter(config.adapters.steward),
};
const engine = new RoundtableEngine({ store, adapters, config });
```

The CLI is thin: parse args, wire dependencies, translate engine events into terminal output.

---

## 9. Security & Permission Model

### 9.1 v1 Security Invariant

> Roundtable itself will not mutate the target path. Roundtable will only write to its own session store. Claude/Codex are invoked in the lowest-permission, non-mutating mode available, with no target path cwd and no direct target-folder access intentionally provided.

v1 is **read-only by design**, not read-only by kernel enforcement. Without OS-level sandboxing, we cannot absolutely prevent a child process from writing. We can ensure we do not give it the means or the instructions to do so.

### 9.2 Enforcement Layers

**Layer 1: Roundtable application (always enforced)**

- Reads from target path (context pack building only)
- Writes only to `~/.local/share/roundtable/`
- Never writes to, deletes from, or modifies the target folder
- Never executes commands against the target folder

**Layer 2: Adapter invocation (always enforced)**

- Spawns CLI processes with `cwd` set to Roundtable-owned temp directory
- Uses `spawn(command, args)`, never shell strings
- Uses lowest-permission CLI flags available
- Does not pass flags that bypass sandboxing, approval prompts, or permission checks
- Does not pass the raw target path as cwd or argument
- Passes context exclusively through the curated context pack
- Captures all stdout/stderr
- Disables shell/tool execution features wherever supported by the provider CLI

**Layer 3: System prompts (defense in depth)**

Each participant's system prompt states:

```
You are participating in a Roundtable deliberation. You are in READ-ONLY mode.

You MUST NOT:
- Write, create, modify, or delete any files
- Execute shell commands, scripts, or tools
- Run package managers (npm, pip, cargo, etc.)
- Perform git operations that mutate state (commit, push, rebase, etc.)
- Modify any system configuration

You MUST NOT request or perform external network fetches, scraping,
package downloads, API calls, or service mutations. The only network
activity expected is the underlying provider CLI invocation required
to produce your response.

You have been provided a curated context pack from the target project.
This is your only source of information about the project.
You do not have filesystem access.
```

The Steward prompt additionally states:

```
You MUST NOT approve or authorize any write, mutation, or execution action.
You MUST NOT escalate permissions beyond read-only.
You MUST NOT direct participants to perform actions outside the deliberation.
```

### 9.3 Participant Visibility

| Resource | User | Claude | Codex | Steward |
|---|---|---|---|---|
| Context pack | yes | yes | yes | yes |
| Full transcript | yes | yes | yes | yes |
| Target folder (direct) | yes (outside RT) | no | no | no |
| Session artifacts | yes (via CLI) | no | no | no |
| Other sessions | yes (via CLI) | no | no | no |

### 9.4 Sensitive Data Handling

- Hard-deny list prevents secret files from entering context pack
- Redaction pass catches leaked patterns in included files
- Adapter environment variables never persisted (only key names)
- Session artifacts are private local app data
- No session data is written to the target folder
- No auto-export, sync, or upload

### 9.5 Adapter Failure as Security Event

- Non-zero exits captured and logged
- stderr captured to artifacts
- Failures appear as visible Roundtable messages in transcript
- Unexpected attempts to invoke disabled capabilities represented as policy violations when detectable

### 9.6 v1 Escalation Model

v1 has no escalation path. All tool/action escalation requests are refused or rendered as recommendations only. The architecture leaves room for a future policy envelope where the Steward may approve routine low-risk actions within explicit constraints, but this is not part of v1.

### 9.7 Future: Layer 4 (OS-level sandboxing)

The adapter interface supports future sandboxing. A `SandboxedAdapter` wrapper could run child processes in read-only mounts, restricted containers, or with network restrictions. This plugs in at the adapter boundary without changing core or the turn loop.

---

## 10. Implementation Milestones

### Milestone 0: Repository Scaffold

**Goal:** Buildable, lintable, testable monorepo with no runtime features.

- pnpm workspace with `apps/cli` + `packages/{core,context,adapters,persistence,config}`
- TypeScript project references, shared tsconfig base
- ESLint + Prettier
- Vitest
- Zod dependency
- Package scripts: `build`, `dev`, `test`, `lint`
- `bin` entry for `roundtable` CLI
- Empty `index.ts` in each package
- GitHub Actions CI: install, build, test, lint
- Design docs committed: `docs/product-spec.md`, `docs/architecture.md`, `docs/security-model.md`, `docs/milestones.md`
- README with project overview
- CLAUDE.md with contributor context

### Milestone 1: Core Types, Config Schema & Event System

**Goal:** The type foundation and config schema everything else builds on.

- All shared types in `packages/core/src/types.ts`
- Discriminated unions for events with typed payloads
- Zod schemas for runtime validation (events, config, StewardDecision)
- `AgentAdapter` interface
- `SessionStore` interface
- Config types and Zod schema in `packages/config`
- Config loading: defaults -> user global -> project local -> CLI flags
- `roundtable.config.yaml` / `.roundtable/config.yaml` support
- Tests for Zod schemas and config resolution

### Milestone 2: Persistence Layer

**Goal:** Sessions can be created, appended to, loaded, and replayed.

- `FileSessionStore` in `packages/persistence`
- `events.jsonl` append-only write + full read with Zod validation on replay
- `meta.json` create + update
- Session directory creation
- Path resolution with `ROUNDTABLE_HOME` override
- Markdown export (transcript, steward summary) as derived views
- Transcript regeneration from events
- Tests with temp directories

### Milestone 3: Context Pack Builder

**Goal:** Given a folder path + config, produce a curated, bounded ContextPack.

- Folder scanning (git-tracked preferred, filesystem fallback)
- File priority ranking
- Default exclusions + hard-deny list
- Budget enforcement
- Redaction pass
- Omitted report with reasons (including budget exhaustion)
- Display path redaction
- Markdown rendering with epistemic boundaries
- Consumes resolved `ContextConfig` from `packages/config`
- Tests against fixture directories

### Milestone 4: Mock Adapters & Turn Loop

**Goal:** Deliberation engine works end-to-end with deterministic mock participants.

- Mock `AgentAdapter` implementations in `packages/adapters` (deterministic responses, configurable delays, simulated errors/timeouts)
- `RoundtableEngine` in `packages/core`
- Deliberation state machine
- Steward decision parsing + validation with parse-failure fallback
- Hard caps enforcement
- Transcript construction with budget controls
- Visible error rendering as `roundtable` participant messages
- AbortSignal propagation
- Double-failure short-circuit
- Event emission throughout
- Integration tests: full deliberation cycle with mock adapters, event log verification

### Milestone 5: CLI Shell

**Goal:** Interactive terminal application, end-to-end with mocks.

- Command parsing: `convene`, `sessions list`, `sessions archive`, `show`, `config show`, `config init`
- All `convene` flags
- Composition root wiring
- Interactive readline loop
- Slash commands: `/exit`, `/stop`, `/status`, `/refresh-context`, `/transcript`, `/help`
- Streaming display renderer (events -> formatted terminal output)
- `--dry-run` mode (no session created)
- Ctrl+C / Ctrl+D / EOF handling
- Mock-based acceptance test: `roundtable convene ./fixtures/sample-project "What should I work on?" --once --mock`

### Milestone 6: Real CLI Adapters

**Goal:** Claude and Codex actually respond.

- `ClaudeAdapter`: spawn `claude` CLI, read-only flags, temp cwd, system prompt, streaming, artifact capture
- `CodexAdapter`: equivalent for Codex CLI
- `StewardAdapter`: Claude CLI with steward prompt + structured output
- CLI detection: actionable errors for missing `claude`/`codex` commands
- Configurable binary paths
- Artifact persistence per invocation
- Temp cwd lifecycle (create, clean up)
- Output truncation with events
- Timeout -> SIGTERM -> grace -> SIGKILL
- Environment redaction
- Integration tests against installed CLIs (manual/CI-optional)

### Milestone 7: Polish & v1 Release

**Goal:** Usable, documented, installable v1.

- README: install, quickstart, examples, v1 non-goals
- `--help` text for all commands
- Error messages for common failures (CLI not installed, path not found, no git)
- `config init` generates commented template
- Session list formatting
- `show` renders clean transcript (with `--regenerate`)
- Edge cases: empty folders, massive repos, no git, permission errors
- End-to-end smoke tests
- npm package or local install via `pnpm link`

### Milestone Dependency Graph

```
M0 (scaffold)
 └-> M1 (types + config)
      ├-> M2 (persistence)    \
      ├-> M3 (context)         |-- can be parallel
      └-> M4 (mock adapters + turn loop) <- depends on M2, M3
           └-> M5 (CLI shell)
                └-> M6 (real adapters)
                     └-> M7 (polish)
```

M2 and M3 can be built in parallel after M1. M4 depends on both.

### Key Principle

Build a fully usable mock-backed Roundtable before touching real Claude/Codex process integration. This keeps the hard process-adapter work isolated from product-loop bugs.

---

## 11. Future Considerations (not v1)

- **Web UI**: React app consuming `core` + `persistence` packages
- **OS-level sandboxing**: SandboxedAdapter wrapper at adapter boundary
- **Steward escalation**: Policy envelope for routine low-risk actions
- **Custom agents**: Pluggable participants beyond Claude/Codex
- **Context refresh**: Automatic or on-demand context pack versioning
- **Session summarization**: Compress long transcripts intelligently
- **Steward-directed turn order**: Dynamic speaker selection
- **Parallel invocation**: Claude and Codex respond concurrently
- **Bun runtime**: Alternative to Node for faster startup

# Roundtable v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI-first local group chat where Claude and Codex deliberate over a user-provided folder, moderated by a Steward, with persistent sessions and curated context packs.

**Architecture:** Event-sourced turn loop with adapter interfaces behind process isolation. The app owns orchestration, adapters hide CLI process differences, context is curated and frozen per session. A fully usable mock-backed system is built first, then real CLI adapters are wired in.

**Tech Stack:** TypeScript, Node.js, pnpm workspaces, Zod (runtime validation), Vitest (tests), Commander (CLI), yaml (config parsing)

**Spec:** `docs/superpowers/specs/2026-05-06-roundtable-v1-design.md`

---

## File Structure

```
roundtable/
  pnpm-workspace.yaml
  package.json                         # root: workspace scripts, shared devDeps
  tsconfig.base.json                   # shared TS compiler options
  tsconfig.json                        # project references
  eslint.config.js                     # flat config ESLint
  .prettierrc                          # Prettier config
  vitest.workspace.ts                  # Vitest workspace config
  .github/workflows/ci.yml            # CI pipeline
  README.md
  CLAUDE.md

  apps/
    cli/
      package.json
      tsconfig.json
      src/
        index.ts                       # entry point, composition root
        commands/
          convene.ts                   # primary command: start/resume deliberation
          sessions.ts                  # list, archive sessions
          show.ts                      # display session transcript
          config.ts                    # show/init config
        render.ts                      # event -> terminal output renderer
        interactive.ts                 # readline loop, slash commands, Ctrl+C handling
        prompts.ts                     # system prompts for each participant

  packages/
    core/
      package.json
      tsconfig.json
      src/
        index.ts                       # re-exports public API
        types.ts                       # all shared types
        schemas.ts                     # Zod schemas for events, StewardDecision
        turn-loop.ts                   # deliberation state machine
        transcript.ts                  # transcript construction + budget
        engine.ts                      # RoundtableEngine orchestrator
      src/__tests__/
        schemas.test.ts
        turn-loop.test.ts
        transcript.test.ts
        engine.test.ts

    config/
      package.json
      tsconfig.json
      src/
        index.ts
        schema.ts                      # Zod schemas for config types
        defaults.ts                    # built-in default values
        load-config.ts                 # resolution: defaults -> global -> project -> CLI
      src/__tests__/
        schema.test.ts
        load-config.test.ts

    persistence/
      package.json
      tsconfig.json
      src/
        index.ts
        paths.ts                       # data dir resolution, ROUNDTABLE_HOME
        jsonl.ts                       # JSONL append + read
        session-store.ts               # FileSessionStore implementation
        markdown-export.ts             # transcript.md, steward-summary.md generation
      src/__tests__/
        paths.test.ts
        jsonl.test.ts
        session-store.test.ts
        markdown-export.test.ts

    context/
      package.json
      tsconfig.json
      src/
        index.ts
        scan-folder.ts                 # git ls-files / filesystem walk
        file-selection.ts              # priority ranking, budget enforcement
        redaction.ts                   # secret pattern scanning
        build-context-pack.ts          # orchestrates scan -> select -> redact -> pack
        markdown-render.ts             # context pack -> markdown with epistemic framing
      src/__tests__/
        scan-folder.test.ts
        file-selection.test.ts
        redaction.test.ts
        build-context-pack.test.ts
        markdown-render.test.ts
      src/__tests__/fixtures/          # sample project directories for testing

    adapters/
      package.json
      tsconfig.json
      src/
        index.ts
        mock.ts                        # MockAdapter for testing
        cli-agent.ts                   # base child process spawning logic
        claude.ts                      # ClaudeAdapter
        codex.ts                       # CodexAdapter
        steward-claude.ts              # StewardAdapter
      src/__tests__/
        mock.test.ts
        cli-agent.test.ts
```

---

## Phase 1: Foundation (Milestones 0-1)

### Task 1: Root Workspace Scaffold

**Files:**

- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create root package.json**

```json
{
  "name": "roundtable",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "pnpm -r run build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.7.0",
    "typescript-eslint": "^8.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true
  }
}
```

- [ ] **Step 4: Create tsconfig.json with project references**

```json
{
  "files": [],
  "references": [
    { "path": "packages/core" },
    { "path": "packages/config" },
    { "path": "packages/persistence" },
    { "path": "packages/context" },
    { "path": "packages/adapters" },
    { "path": "apps/cli" }
  ]
}
```

- [ ] **Step 5: Run `pnpm install`**

Run: `pnpm install`
Expected: lockfile created, no errors

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json tsconfig.json pnpm-lock.yaml
git commit -m "feat: root workspace scaffold with pnpm, TypeScript base config"
```

---

### Task 2: Package Scaffolds

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/index.ts`
- Create: `packages/persistence/package.json`, `packages/persistence/tsconfig.json`, `packages/persistence/src/index.ts`
- Create: `packages/context/package.json`, `packages/context/tsconfig.json`, `packages/context/src/index.ts`
- Create: `packages/adapters/package.json`, `packages/adapters/tsconfig.json`, `packages/adapters/src/index.ts`
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/index.ts`

- [ ] **Step 1: Create packages/core scaffold**

`packages/core/package.json`:

```json
{
  "name": "@roundtable/core",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "nanoid": "^5.0.0",
    "zod": "^3.24.0"
  }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

`packages/core/src/index.ts`:

```ts
// @roundtable/core — types, schemas, interfaces, engine
export {};
```

- [ ] **Step 2: Create packages/config scaffold**

`packages/config/package.json`:

```json
{
  "name": "@roundtable/config",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "@roundtable/core": "workspace:*",
    "yaml": "^2.7.0",
    "zod": "^3.24.0"
  }
}
```

`packages/config/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/config/src/index.ts`:

```ts
// @roundtable/config — config schema, loading, defaults
export {};
```

- [ ] **Step 3: Create packages/persistence scaffold**

`packages/persistence/package.json`:

```json
{
  "name": "@roundtable/persistence",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "@roundtable/core": "workspace:*"
  }
}
```

`packages/persistence/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/persistence/src/index.ts`:

```ts
// @roundtable/persistence — session store, JSONL, markdown export
export {};
```

- [ ] **Step 4: Create packages/context scaffold**

`packages/context/package.json`:

```json
{
  "name": "@roundtable/context",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "@roundtable/core": "workspace:*",
    "minimatch": "^10.0.0"
  }
}
```

`packages/context/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/context/src/index.ts`:

```ts
// @roundtable/context — folder scanner, context pack builder
export {};
```

- [ ] **Step 5: Create packages/adapters scaffold**

`packages/adapters/package.json`:

```json
{
  "name": "@roundtable/adapters",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b"
  },
  "dependencies": {
    "@roundtable/core": "workspace:*"
  }
}
```

`packages/adapters/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [{ "path": "../core" }]
}
```

`packages/adapters/src/index.ts`:

```ts
// @roundtable/adapters — mock, Claude, Codex, Steward adapters
export {};
```

- [ ] **Step 6: Create apps/cli scaffold**

`apps/cli/package.json`:

```json
{
  "name": "@roundtable/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "roundtable": "dist/index.js"
  },
  "scripts": {
    "build": "tsc -b",
    "dev": "node --import tsx src/index.ts"
  },
  "dependencies": {
    "@roundtable/core": "workspace:*",
    "@roundtable/config": "workspace:*",
    "@roundtable/persistence": "workspace:*",
    "@roundtable/context": "workspace:*",
    "@roundtable/adapters": "workspace:*",
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

`apps/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/core" },
    { "path": "../../packages/config" },
    { "path": "../../packages/persistence" },
    { "path": "../../packages/context" },
    { "path": "../../packages/adapters" }
  ]
}
```

`apps/cli/src/index.ts`:

```ts
#!/usr/bin/env node
// Roundtable CLI — composition root
console.log("roundtable v0.0.1");
```

- [ ] **Step 7: Install all dependencies**

Run: `pnpm install`
Expected: all workspace packages linked, lockfile updated

- [ ] **Step 8: Verify build**

Run: `pnpm build`
Expected: all packages compile, `dist/` created in each package

- [ ] **Step 9: Commit**

```bash
git add apps/ packages/ pnpm-lock.yaml
git commit -m "feat: scaffold all workspace packages and CLI app"
```

---

### Task 3: Tooling (ESLint, Prettier, Vitest)

**Files:**

- Create: `eslint.config.js`
- Create: `.prettierrc`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create ESLint flat config**

`eslint.config.js`:

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, prettier, {
  ignores: ["**/dist/**", "**/node_modules/**"],
});
```

- [ ] **Step 2: Create Prettier config**

`.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 3: Create Vitest workspace config**

`vitest.workspace.ts`:

```ts
import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*/", "apps/*/"]);
```

- [ ] **Step 4: Create .gitignore**

`.gitignore`:

```
node_modules/
dist/
*.tsbuildinfo
.env*
```

- [ ] **Step 5: Verify lint passes**

Run: `pnpm lint`
Expected: no errors

- [ ] **Step 6: Verify test runner works**

Run: `pnpm test`
Expected: exits cleanly (no tests yet, but no config errors)

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js .prettierrc vitest.workspace.ts .gitignore
git commit -m "feat: add ESLint, Prettier, Vitest, and .gitignore"
```

---

### Task 4: CI Pipeline

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create GitHub Actions CI**

`.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm lint
      - run: pnpm format:check
      - run: pnpm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/
git commit -m "feat: add GitHub Actions CI pipeline"
```

---

### Task 5: README and CLAUDE.md

**Files:**

- Modify: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write README.md**

````markdown
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
````

## Architecture

See `docs/superpowers/specs/2026-05-06-roundtable-v1-design.md` for the full design spec.

````

- [ ] **Step 2: Write CLAUDE.md**

```markdown
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
````

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "feat: add README and CLAUDE.md with project overview"
```

---

### Task 6: Core Types

**Files:**

- Create: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write all shared types**

`packages/core/src/types.ts`:

```ts
// === Participants ===

export type TranscriptParticipant = "user" | "claude" | "codex" | "steward" | "roundtable";

// === Session State ===

export type SessionRuntimeState = "awaiting_user" | "deliberating" | "archived" | "error";

// === Deliberation State ===

export type DeliberationState =
  | "started"
  | "invoking_claude"
  | "invoking_codex"
  | "invoking_steward"
  | "concluded"
  | "error";

export type Deliberation = {
  id: string;
  contextPackId: string;
  round: number;
  maxRounds: number;
  state: DeliberationState;
};

// === Steward Decision ===

export type StewardDecision = {
  status: "concluded" | "continue" | "needs_user";
  reason: string;
  summary: string;
  decisionPoint?: string;
  recommendedActions?: string[];
  nextSpeakerHint?: "claude" | "codex";
};

// === Events ===

export type EventType =
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

export type SessionEvent = {
  id: string;
  type: EventType;
  timestamp: string;
  sessionId: string;
  deliberationId?: string;
  contextPackId?: string;
  participant?: TranscriptParticipant;
  data: Record<string, unknown>;
};

// === Transcript ===

export type TranscriptMessage = {
  participant: TranscriptParticipant;
  content: string;
  timestamp: string;
};

// === Context Pack ===

export type FileCategory =
  | "roundtable_config"
  | "agent_config"
  | "project_meta"
  | "documentation"
  | "source"
  | "config"
  | "other";

export type ContextFile = {
  path: string;
  category: FileCategory;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type DirectoryTree = {
  name: string;
  type: "file" | "directory";
  children?: DirectoryTree[];
};

export type GitSummary = {
  branch: string;
  status: string;
  recentCommits: { hash: string; message: string; date: string }[];
  diffStat?: string;
};

export type OmittedReport = {
  categories: { category: string; count: number; reason: string }[];
  files: { path: string; reason: string }[];
};

export type ContextPack = {
  id: string;
  version: number;
  targetPath: string;
  displayPath: string;
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

// === Config ===

export type ContextConfig = {
  budgetBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTreeDepth: number;
  includes?: string[];
  excludes?: string[];
};

export type AdapterMode = "read_only" | "mock";

export type AdapterLimits = {
  invocationTimeoutMs: number;
  maxOutputBytes: number;
  gracefulShutdownMs: number;
};

export type AdapterConfig = {
  command: string;
  mode: AdapterMode;
  limits: AdapterLimits;
};

export type DeliberationLimits = {
  maxRounds: number;
  participantTimeoutMs: number;
  deliberationTimeoutMs: number;
  maxTranscriptBytes?: number;
};

export type RoundtableConfig = {
  dataDir: string;
  context: ContextConfig;
  deliberation: DeliberationLimits;
  adapters: {
    claude: AdapterConfig;
    codex: AdapterConfig;
    steward: AdapterConfig;
  };
};

// === Session Meta ===

export type ParticipantConfig = {
  id: TranscriptParticipant;
  adapter: string;
};

/** Alias for clarity — a fully resolved config with no optionals */
export type ResolvedConfig = RoundtableConfig;

export type SessionMeta = {
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

// === Session (runtime object) ===

export type Session = {
  meta: SessionMeta;
  events: SessionEvent[];
  currentDeliberation?: Deliberation;
};

// === Agent Adapter Interface ===

export type AgentEvent =
  | { type: "invocation_started"; command: string; pid: number; timestamp: string }
  | { type: "invocation_metadata"; cwd: string; command: string; args: string[]; envKeys: string[] }
  | { type: "chunk"; content: string; stream: "stdout" | "stderr" }
  | { type: "response_end"; content: string; durationMs: number; exitCode: number }
  | { type: "error"; error: string; stderr?: string; exitCode?: number }
  | { type: "timeout"; durationMs: number; killed: boolean }
  | {
      type: "output_truncated";
      stream: "stdout" | "stderr";
      originalBytes: number;
      keptBytes: number;
    };

export type AgentInput = {
  invocationId: string;
  contextPack: ContextPack;
  transcript: TranscriptMessage[];
  systemPrompt: string;
  deliberationId: string;
};

export interface AgentAdapter {
  id: string;
  invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent>;
}

// === Session Store Interface ===

export interface SessionStore {
  createSession(meta: SessionMeta): Promise<void>;
  loadSession(sessionId: string): Promise<SessionMeta>;
  updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void>;
  appendEvent(sessionId: string, event: SessionEvent): Promise<void>;
  loadEvents(sessionId: string): Promise<SessionEvent[]>;
  listSessions(): Promise<SessionMeta[]>;
  saveContextPack(sessionId: string, pack: ContextPack): Promise<void>;
  loadContextPack(sessionId: string, contextPackId: string): Promise<ContextPack>;
  saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void>;
}
```

- [ ] **Step 2: Update index.ts to re-export**

`packages/core/src/index.ts`:

```ts
export * from "./types.js";
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @roundtable/core build`
Expected: compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add all shared types and interfaces"
```

---

### Task 7: Zod Schemas for Events and Steward Decision

**Files:**

- Create: `packages/core/src/schemas.ts`
- Create: `packages/core/src/__tests__/schemas.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/schemas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { StewardDecisionSchema, SessionEventSchema } from "../schemas.js";

describe("StewardDecisionSchema", () => {
  it("parses a valid concluded decision", () => {
    const input = {
      status: "concluded",
      reason: "Both participants agree",
      summary: "The team should refactor the auth module",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("concluded");
      expect(result.data.decisionPoint).toBeUndefined();
    }
  });

  it("parses a continue decision with all optional fields", () => {
    const input = {
      status: "continue",
      reason: "Disagreement on approach",
      summary: "Claude prefers adapter pattern, Codex prefers rewrite",
      decisionPoint: "Whether to refactor incrementally or replace wholesale",
      recommendedActions: ["Review the session handler", "Check token storage"],
      nextSpeakerHint: "claude",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const input = {
      status: "invalid",
      reason: "test",
      summary: "test",
    };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing required fields", () => {
    const input = { status: "concluded" };
    const result = StewardDecisionSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("SessionEventSchema", () => {
  it("parses a user_message event", () => {
    const input = {
      id: "evt_001",
      type: "user_message",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      participant: "user",
      data: { content: "Hello world" },
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("parses an event with optional fields omitted", () => {
    const input = {
      id: "evt_002",
      type: "session_started",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      data: {},
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects unknown event type", () => {
    const input = {
      id: "evt_003",
      type: "unknown_type",
      timestamp: "2026-05-06T12:00:00Z",
      sessionId: "sess_001",
      data: {},
    };
    const result = SessionEventSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/schemas.test.ts`
Expected: FAIL — cannot resolve `../schemas.js`

- [ ] **Step 3: Write the Zod schemas**

`packages/core/src/schemas.ts`:

```ts
import { z } from "zod";

export const StewardDecisionSchema = z.object({
  status: z.enum(["concluded", "continue", "needs_user"]),
  reason: z.string(),
  summary: z.string(),
  decisionPoint: z.string().optional(),
  recommendedActions: z.array(z.string()).optional(),
  nextSpeakerHint: z.enum(["claude", "codex"]).optional(),
});

export const TranscriptParticipantSchema = z.enum([
  "user",
  "claude",
  "codex",
  "steward",
  "roundtable",
]);

export const EventTypeSchema = z.enum([
  "user_message",
  "deliberation_started",
  "agent_invocation_started",
  "agent_invocation_metadata",
  "agent_chunk",
  "agent_response_end",
  "agent_error",
  "agent_invocation_timeout",
  "output_truncated",
  "steward_decision",
  "steward_parse_error",
  "deliberation_ended",
  "deliberation_interrupted",
  "context_pack_built",
  "session_started",
  "session_archived",
  "engine_state_changed",
]);

export const SessionEventSchema = z.object({
  id: z.string(),
  type: EventTypeSchema,
  timestamp: z.string(),
  sessionId: z.string(),
  deliberationId: z.string().optional(),
  contextPackId: z.string().optional(),
  participant: TranscriptParticipantSchema.optional(),
  data: z.record(z.unknown()),
});

export const SessionMetaSchema = z.object({
  id: z.string(),
  status: z.enum(["awaiting_user", "deliberating", "archived", "error"]),
  title: z.string().optional(),
  targetPath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  currentContextPackId: z.string(),
  configSnapshot: z.record(z.unknown()), // generic at storage boundary; typed as ResolvedConfig internally
  participants: z.array(
    z.object({
      id: TranscriptParticipantSchema,
      adapter: z.string(),
    }),
  ),
  latestStewardSummary: z.string().optional(),
});
```

- [ ] **Step 4: Update index.ts**

Add to `packages/core/src/index.ts`:

```ts
export * from "./types.js";
export * from "./schemas.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/schemas.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add Zod schemas for events, StewardDecision, SessionMeta"
```

---

### Task 8: Config Schema and Loading

**Files:**

- Create: `packages/config/src/schema.ts`
- Create: `packages/config/src/defaults.ts`
- Create: `packages/config/src/load-config.ts`
- Create: `packages/config/src/__tests__/load-config.test.ts`
- Modify: `packages/config/src/index.ts`

- [ ] **Step 1: Write the failing test for config resolution**

`packages/config/src/__tests__/load-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveConfig, DEFAULT_CONFIG } from "../load-config.js";

describe("resolveConfig", () => {
  it("returns defaults when no overrides provided", () => {
    const config = resolveConfig({});
    expect(config.dataDir).toContain("roundtable");
    expect(config.context.budgetBytes).toBe(100_000);
    expect(config.context.maxFiles).toBe(50);
    expect(config.deliberation.maxRounds).toBe(2);
    expect(config.adapters.claude.command).toBe("claude");
    expect(config.adapters.codex.command).toBe("codex");
    expect(config.adapters.steward.command).toBe("claude");
  });

  it("CLI overrides take precedence over defaults", () => {
    const config = resolveConfig({
      cliOverrides: {
        context: { budgetBytes: 50_000, maxFiles: 25 },
        deliberation: { maxRounds: 1 },
      },
    });
    expect(config.context.budgetBytes).toBe(50_000);
    expect(config.context.maxFiles).toBe(25);
    expect(config.deliberation.maxRounds).toBe(1);
    // Non-overridden values stay at defaults
    expect(config.context.maxFileBytes).toBe(10_000);
  });

  it("respects ROUNDTABLE_HOME env var", () => {
    const config = resolveConfig({
      env: { ROUNDTABLE_HOME: "/tmp/rt-test" },
    });
    expect(config.dataDir).toBe("/tmp/rt-test");
  });

  it("project config overrides global config", () => {
    const config = resolveConfig({
      globalConfig: { context: { budgetBytes: 80_000 } },
      projectConfig: { context: { budgetBytes: 60_000 } },
    });
    expect(config.context.budgetBytes).toBe(60_000);
  });

  it("CLI overrides take precedence over project config", () => {
    const config = resolveConfig({
      projectConfig: { context: { budgetBytes: 60_000 } },
      cliOverrides: { context: { budgetBytes: 40_000 } },
    });
    expect(config.context.budgetBytes).toBe(40_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/config/src/__tests__/load-config.test.ts`
Expected: FAIL — cannot resolve `../load-config.js`

- [ ] **Step 3: Write config schema**

`packages/config/src/schema.ts`:

```ts
import { z } from "zod";

export const ContextConfigSchema = z.object({
  budgetBytes: z.number().positive(),
  maxFiles: z.number().positive().int(),
  maxFileBytes: z.number().positive(),
  maxTreeDepth: z.number().positive().int(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
});

export const AdapterLimitsSchema = z.object({
  invocationTimeoutMs: z.number().positive(),
  maxOutputBytes: z.number().positive(),
  gracefulShutdownMs: z.number().positive(),
});

export const AdapterConfigSchema = z.object({
  command: z.string(),
  mode: z.enum(["read_only", "mock"]),
  limits: AdapterLimitsSchema,
});

export const DeliberationLimitsSchema = z.object({
  maxRounds: z.number().positive().int(),
  participantTimeoutMs: z.number().positive(),
  deliberationTimeoutMs: z.number().positive(),
  maxTranscriptBytes: z.number().positive().optional(),
});

export const RoundtableConfigSchema = z.object({
  dataDir: z.string(),
  context: ContextConfigSchema,
  deliberation: DeliberationLimitsSchema,
  adapters: z.object({
    claude: AdapterConfigSchema,
    codex: AdapterConfigSchema,
    steward: AdapterConfigSchema,
  }),
});

/** Partial config shape used for YAML files and CLI overrides */
export const PartialConfigSchema = RoundtableConfigSchema.deepPartial();

export type PartialConfig = z.infer<typeof PartialConfigSchema>;
```

- [ ] **Step 4: Write defaults**

`packages/config/src/defaults.ts`:

```ts
import type { RoundtableConfig } from "@roundtable/core";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_ADAPTER_LIMITS = {
  invocationTimeoutMs: 120_000,
  maxOutputBytes: 512_000,
  gracefulShutdownMs: 5_000,
};

export function getDefaultDataDir(): string {
  return join(homedir(), ".local", "share", "roundtable");
}

export const DEFAULT_CONFIG: RoundtableConfig = {
  dataDir: getDefaultDataDir(),
  context: {
    budgetBytes: 100_000,
    maxFiles: 50,
    maxFileBytes: 10_000,
    maxTreeDepth: 5,
  },
  deliberation: {
    maxRounds: 2,
    participantTimeoutMs: 120_000,
    deliberationTimeoutMs: 600_000,
  },
  adapters: {
    claude: { command: "claude", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
    codex: { command: "codex", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
    steward: { command: "claude", mode: "read_only", limits: DEFAULT_ADAPTER_LIMITS },
  },
};
```

- [ ] **Step 5: Write config loader**

`packages/config/src/load-config.ts`:

```ts
import type { RoundtableConfig } from "@roundtable/core";
import { DEFAULT_CONFIG, getDefaultDataDir } from "./defaults.js";
import type { PartialConfig } from "./schema.js";

export { DEFAULT_CONFIG };

type ResolveInput = {
  env?: Record<string, string | undefined>;
  globalConfig?: PartialConfig;
  projectConfig?: PartialConfig;
  cliOverrides?: PartialConfig;
};

export function resolveConfig(input: ResolveInput): RoundtableConfig {
  const { env = {}, globalConfig = {}, projectConfig = {}, cliOverrides = {} } = input;

  // Start with defaults
  let config = structuredClone(DEFAULT_CONFIG);

  // Layer 1: ROUNDTABLE_HOME env var
  if (env.ROUNDTABLE_HOME) {
    config.dataDir = env.ROUNDTABLE_HOME;
  }

  // Layer 2: global config (~/.config/roundtable/config.yaml)
  config = deepMerge(config, globalConfig);

  // Layer 3: project config (roundtable.config.yaml / .roundtable/config.yaml)
  config = deepMerge(config, projectConfig);

  // Layer 4: CLI flags
  config = deepMerge(config, cliOverrides);

  // Re-apply env override (it wins over config files but not CLI flags)
  if (env.ROUNDTABLE_HOME && !cliOverrides.dataDir) {
    config.dataDir = env.ROUNDTABLE_HOME;
  }

  return config;
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: unknown): T {
  if (!source || typeof source !== "object") return target;
  const result = { ...target };
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (value === undefined) continue;
    const existing = result[key as keyof T];
    if (
      existing !== null &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        existing as Record<string, unknown>,
        value,
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
```

- [ ] **Step 6: Update index.ts**

`packages/config/src/index.ts`:

```ts
export { resolveConfig, DEFAULT_CONFIG } from "./load-config.js";
export { getDefaultDataDir } from "./defaults.js";
export * from "./schema.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run packages/config/src/__tests__/load-config.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 8: Commit**

```bash
git add packages/config/
git commit -m "feat(config): add config schema, defaults, and layered resolution"
```

---

## Phase 2: Data Layer (Milestones 2-3)

### Task 9: Paths Module

**Files:**

- Create: `packages/persistence/src/paths.ts`
- Create: `packages/persistence/src/__tests__/paths.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/persistence/src/__tests__/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sessionDir, contextPackPath, artifactPath, eventsPath, metaPath } from "../paths.js";

describe("paths", () => {
  const dataDir = "/tmp/roundtable";

  it("builds session directory path", () => {
    expect(sessionDir(dataDir, "sess_001")).toBe("/tmp/roundtable/sessions/sess_001");
  });

  it("builds events.jsonl path", () => {
    expect(eventsPath(dataDir, "sess_001")).toBe("/tmp/roundtable/sessions/sess_001/events.jsonl");
  });

  it("builds meta.json path", () => {
    expect(metaPath(dataDir, "sess_001")).toBe("/tmp/roundtable/sessions/sess_001/meta.json");
  });

  it("builds context pack path", () => {
    expect(contextPackPath(dataDir, "sess_001", "cp_001")).toBe(
      "/tmp/roundtable/sessions/sess_001/context-packs/cp_001.json",
    );
  });

  it("builds artifact path", () => {
    expect(artifactPath(dataDir, "sess_001", "claude", "inv_001", "stdout.log")).toBe(
      "/tmp/roundtable/sessions/sess_001/artifacts/claude/inv_001.stdout.log",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/persistence/src/__tests__/paths.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement paths module**

`packages/persistence/src/paths.ts`:

```ts
import { join } from "node:path";

export function sessionsRoot(dataDir: string): string {
  return join(dataDir, "sessions");
}

export function sessionDir(dataDir: string, sessionId: string): string {
  return join(sessionsRoot(dataDir), sessionId);
}

export function eventsPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "events.jsonl");
}

export function metaPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "meta.json");
}

export function contextPackPath(dataDir: string, sessionId: string, contextPackId: string): string {
  return join(sessionDir(dataDir, sessionId), "context-packs", `${contextPackId}.json`);
}

export function contextPackMdPath(
  dataDir: string,
  sessionId: string,
  contextPackId: string,
): string {
  return join(sessionDir(dataDir, sessionId), "context-packs", `${contextPackId}.md`);
}

export function artifactPath(
  dataDir: string,
  sessionId: string,
  participant: string,
  invocationId: string,
  filename: string,
): string {
  return join(
    sessionDir(dataDir, sessionId),
    "artifacts",
    participant,
    `${invocationId}.${filename}`,
  );
}

export function transcriptPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "transcript.md");
}

export function stewardSummaryPath(dataDir: string, sessionId: string): string {
  return join(sessionDir(dataDir, sessionId), "steward-summary.md");
}

export function tmpDir(dataDir: string, invocationId: string): string {
  return join(dataDir, "tmp", invocationId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/persistence/src/__tests__/paths.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/persistence/
git commit -m "feat(persistence): add path resolution module"
```

---

### Task 10: JSONL Reader/Writer

**Files:**

- Create: `packages/persistence/src/jsonl.ts`
- Create: `packages/persistence/src/__tests__/jsonl.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/persistence/src/__tests__/jsonl.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { appendJsonl, readJsonl } from "../jsonl.js";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("jsonl", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `rt-test-${randomUUID()}`);
    await mkdir(dir, { recursive: true });
    filePath = join(dir, "test.jsonl");
  });

  it("appends a record and reads it back", async () => {
    const record = { id: "1", type: "test", data: { value: 42 } };
    await appendJsonl(filePath, record);
    const records = await readJsonl(filePath);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual(record);
  });

  it("appends multiple records", async () => {
    await appendJsonl(filePath, { id: "1" });
    await appendJsonl(filePath, { id: "2" });
    await appendJsonl(filePath, { id: "3" });
    const records = await readJsonl(filePath);
    expect(records).toHaveLength(3);
    expect(records.map((r: { id: string }) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("returns empty array for non-existent file", async () => {
    const records = await readJsonl(join(dir, "missing.jsonl"));
    expect(records).toEqual([]);
  });

  it("writes one JSON object per line", async () => {
    await appendJsonl(filePath, { a: 1 });
    await appendJsonl(filePath, { b: 2 });
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ a: 1 });
    expect(JSON.parse(lines[1])).toEqual({ b: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/persistence/src/__tests__/jsonl.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement JSONL module**

`packages/persistence/src/jsonl.ts`:

```ts
import { appendFile, readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export async function appendJsonl(filePath: string, record: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await appendFile(filePath, line, "utf-8");
}

export async function readJsonl<T = unknown>(filePath: string): Promise<T[]> {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return content
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/persistence/src/__tests__/jsonl.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/persistence/
git commit -m "feat(persistence): add JSONL append-only reader/writer"
```

---

### Task 11: File Session Store

**Files:**

- Create: `packages/persistence/src/session-store.ts`
- Create: `packages/persistence/src/__tests__/session-store.test.ts`
- Modify: `packages/persistence/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/persistence/src/__tests__/session-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { FileSessionStore } from "../session-store.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { SessionMeta, SessionEvent, ContextPack } from "@roundtable/core";

function makeMeta(id: string): SessionMeta {
  return {
    id,
    status: "awaiting_user",
    targetPath: "/tmp/test-project",
    createdAt: "2026-05-06T12:00:00Z",
    updatedAt: "2026-05-06T12:00:00Z",
    currentContextPackId: "cp_001",
    configSnapshot: {} as SessionMeta["configSnapshot"],
    participants: [{ id: "user", adapter: "user" }],
  };
}

function makeEvent(id: string, type: string): SessionEvent {
  return {
    id,
    type: type as SessionEvent["type"],
    timestamp: "2026-05-06T12:00:00Z",
    sessionId: "sess_001",
    data: { content: "test" },
  };
}

describe("FileSessionStore", () => {
  let dataDir: string;
  let store: FileSessionStore;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `rt-store-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });
    store = new FileSessionStore(dataDir);
  });

  it("creates and loads a session", async () => {
    const meta = makeMeta("sess_001");
    await store.createSession(meta);
    const loaded = await store.loadSession("sess_001");
    expect(loaded.id).toBe("sess_001");
    expect(loaded.status).toBe("awaiting_user");
  });

  it("updates meta fields", async () => {
    await store.createSession(makeMeta("sess_002"));
    await store.updateMeta("sess_002", {
      status: "deliberating",
      title: "Test session",
    });
    const loaded = await store.loadSession("sess_002");
    expect(loaded.status).toBe("deliberating");
    expect(loaded.title).toBe("Test session");
  });

  it("appends and loads events", async () => {
    await store.createSession(makeMeta("sess_003"));
    await store.appendEvent("sess_003", makeEvent("evt_1", "user_message"));
    await store.appendEvent("sess_003", makeEvent("evt_2", "agent_response_end"));
    const events = await store.loadEvents("sess_003");
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe("evt_1");
    expect(events[1].id).toBe("evt_2");
  });

  it("lists sessions", async () => {
    await store.createSession(makeMeta("sess_a"));
    await store.createSession(makeMeta("sess_b"));
    const list = await store.listSessions();
    const ids = list.map((s) => s.id);
    expect(ids).toContain("sess_a");
    expect(ids).toContain("sess_b");
  });

  it("saves and loads artifacts", async () => {
    await store.createSession(makeMeta("sess_004"));
    await store.saveArtifact("sess_004", "claude", "inv_001", "stdout.log", "hello world");
    // Artifact is written — verify by loading it
    const { readFile } = await import("node:fs/promises");
    const { artifactPath } = await import("../paths.js");
    const content = await readFile(
      artifactPath(dataDir, "sess_004", "claude", "inv_001", "stdout.log"),
      "utf-8",
    );
    expect(content).toBe("hello world");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/persistence/src/__tests__/session-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement FileSessionStore**

`packages/persistence/src/session-store.ts`:

```ts
import type { SessionMeta, SessionEvent, SessionStore, ContextPack } from "@roundtable/core";
import { SessionEventSchema, SessionMetaSchema } from "@roundtable/core";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.js";
import {
  sessionDir,
  sessionsRoot,
  eventsPath,
  metaPath,
  contextPackPath,
  contextPackMdPath,
  artifactPath,
} from "./paths.js";

export class FileSessionStore implements SessionStore {
  constructor(private dataDir: string) {}

  async createSession(meta: SessionMeta): Promise<void> {
    const dir = sessionDir(this.dataDir, meta.id);
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, "context-packs"), { recursive: true });
    await mkdir(join(dir, "artifacts"), { recursive: true });
    await writeFile(metaPath(this.dataDir, meta.id), JSON.stringify(meta, null, 2), "utf-8");
    // Create empty events file
    await writeFile(eventsPath(this.dataDir, meta.id), "", "utf-8");
  }

  async loadSession(sessionId: string): Promise<SessionMeta> {
    const raw = await readFile(metaPath(this.dataDir, sessionId), "utf-8");
    return JSON.parse(raw) as SessionMeta;
  }

  async updateMeta(sessionId: string, updates: Partial<SessionMeta>): Promise<void> {
    const current = await this.loadSession(sessionId);
    const updated = { ...current, ...updates };
    await writeFile(metaPath(this.dataDir, sessionId), JSON.stringify(updated, null, 2), "utf-8");
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await appendJsonl(eventsPath(this.dataDir, sessionId), event);
  }

  async loadEvents(sessionId: string): Promise<SessionEvent[]> {
    return readJsonl<SessionEvent>(eventsPath(this.dataDir, sessionId));
  }

  async listSessions(): Promise<SessionMeta[]> {
    const root = sessionsRoot(this.dataDir);
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return [];
    }
    const sessions: SessionMeta[] = [];
    for (const entry of entries) {
      try {
        const meta = await this.loadSession(entry);
        sessions.push(meta);
      } catch {
        // skip corrupt/incomplete sessions
      }
    }
    return sessions;
  }

  async saveContextPack(sessionId: string, pack: ContextPack): Promise<void> {
    const jsonPath = contextPackPath(this.dataDir, sessionId, pack.id);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(pack, null, 2), "utf-8");
  }

  async loadContextPack(sessionId: string, contextPackId: string): Promise<ContextPack> {
    const raw = await readFile(contextPackPath(this.dataDir, sessionId, contextPackId), "utf-8");
    return JSON.parse(raw) as ContextPack;
  }

  async saveArtifact(
    sessionId: string,
    participant: string,
    invocationId: string,
    filename: string,
    content: string,
  ): Promise<void> {
    const path = artifactPath(this.dataDir, sessionId, participant, invocationId, filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
  }
}
```

- [ ] **Step 4: Update index.ts**

`packages/persistence/src/index.ts`:

```ts
export { FileSessionStore } from "./session-store.js";
export { appendJsonl, readJsonl } from "./jsonl.js";
export * from "./paths.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/persistence/src/__tests__/session-store.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/
git commit -m "feat(persistence): add FileSessionStore with JSONL events and artifacts"
```

---

### Task 12: Markdown Export

**Files:**

- Create: `packages/persistence/src/markdown-export.ts`
- Create: `packages/persistence/src/__tests__/markdown-export.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/persistence/src/__tests__/markdown-export.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateTranscriptMarkdown, generateStewardSummaryMarkdown } from "../markdown-export.js";
import type { SessionEvent } from "@roundtable/core";

describe("generateTranscriptMarkdown", () => {
  it("renders user messages and agent responses", () => {
    const events: SessionEvent[] = [
      {
        id: "1",
        type: "user_message",
        timestamp: "2026-05-06T12:00:00Z",
        sessionId: "s1",
        participant: "user",
        data: { content: "What should I work on?" },
      },
      {
        id: "2",
        type: "agent_response_end",
        timestamp: "2026-05-06T12:00:05Z",
        sessionId: "s1",
        participant: "claude",
        data: {
          content: "I recommend focusing on the auth module.",
          durationMs: 5000,
          exitCode: 0,
        },
      },
      {
        id: "3",
        type: "agent_response_end",
        timestamp: "2026-05-06T12:00:10Z",
        sessionId: "s1",
        participant: "codex",
        data: {
          content: "Agreed, the auth module needs attention.",
          durationMs: 4000,
          exitCode: 0,
        },
      },
    ];

    const md = generateTranscriptMarkdown(events, "test-session");
    expect(md).toContain("# Roundtable Transcript");
    expect(md).toContain("**You**");
    expect(md).toContain("What should I work on?");
    expect(md).toContain("**Claude**");
    expect(md).toContain("I recommend focusing on the auth module.");
    expect(md).toContain("**Codex**");
  });

  it("renders steward decisions as summaries", () => {
    const events: SessionEvent[] = [
      {
        id: "1",
        type: "steward_decision",
        timestamp: "2026-05-06T12:00:15Z",
        sessionId: "s1",
        participant: "steward",
        data: {
          status: "concluded",
          reason: "Consensus reached",
          summary: "Both agree on refactoring auth.",
        },
      },
    ];
    const md = generateTranscriptMarkdown(events, "s1");
    expect(md).toContain("**Steward**");
    expect(md).toContain("Both agree on refactoring auth.");
  });

  it("renders visible errors as Roundtable messages", () => {
    const events: SessionEvent[] = [
      {
        id: "1",
        type: "agent_error",
        timestamp: "2026-05-06T12:00:05Z",
        sessionId: "s1",
        participant: "roundtable",
        data: { error: "Codex failed to respond: invocation timed out after 120s." },
      },
    ];
    const md = generateTranscriptMarkdown(events, "s1");
    expect(md).toContain("**Roundtable**");
    expect(md).toContain("invocation timed out");
  });
});

describe("generateStewardSummaryMarkdown", () => {
  it("renders latest steward decision", () => {
    const md = generateStewardSummaryMarkdown({
      status: "concluded",
      reason: "Consensus reached",
      summary: "The auth module should be refactored using an adapter pattern.",
      decisionPoint: "Incremental refactor vs. full rewrite",
      recommendedActions: ["Start with session handler", "Add integration tests"],
    });
    expect(md).toContain("# Steward Summary");
    expect(md).toContain("concluded");
    expect(md).toContain("adapter pattern");
    expect(md).toContain("Start with session handler");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/persistence/src/__tests__/markdown-export.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement markdown export**

`packages/persistence/src/markdown-export.ts`:

```ts
import type { SessionEvent, StewardDecision } from "@roundtable/core";

const DISPLAY_EVENTS = new Set([
  "user_message",
  "agent_response_end",
  "steward_decision",
  "agent_error",
]);

const PARTICIPANT_LABELS: Record<string, string> = {
  user: "You",
  claude: "Claude",
  codex: "Codex",
  steward: "Steward",
  roundtable: "Roundtable",
};

function extractContent(event: SessionEvent): string {
  const data = event.data;
  if (event.type === "user_message") return data.content as string;
  if (event.type === "agent_response_end") return data.content as string;
  if (event.type === "steward_decision") return (data as StewardDecision).summary;
  if (event.type === "agent_error") return data.error as string;
  return "";
}

export function generateTranscriptMarkdown(events: SessionEvent[], sessionId: string): string {
  const lines: string[] = [
    `# Roundtable Transcript`,
    "",
    `Session: \`${sessionId}\``,
    "",
    "---",
    "",
  ];

  for (const event of events) {
    if (!DISPLAY_EVENTS.has(event.type)) continue;
    if (!event.participant) continue;

    const label = PARTICIPANT_LABELS[event.participant] ?? event.participant;
    const content = extractContent(event);
    lines.push(`**${label}**`);
    lines.push("");
    lines.push(content);
    lines.push("");
  }

  return lines.join("\n");
}

export function generateStewardSummaryMarkdown(decision: StewardDecision): string {
  const lines: string[] = [
    "# Steward Summary",
    "",
    `**Status:** ${decision.status}`,
    "",
    `**Reason:** ${decision.reason}`,
    "",
    "## Summary",
    "",
    decision.summary,
    "",
  ];

  if (decision.decisionPoint) {
    lines.push(`## Decision Point`, "", decision.decisionPoint, "");
  }

  if (decision.recommendedActions && decision.recommendedActions.length > 0) {
    lines.push("## Recommended Actions", "");
    for (const action of decision.recommendedActions) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
```

- [ ] **Step 4: Update index.ts**

Add to `packages/persistence/src/index.ts`:

```ts
export { generateTranscriptMarkdown, generateStewardSummaryMarkdown } from "./markdown-export.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/persistence/src/__tests__/markdown-export.test.ts`
Expected: all 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/persistence/
git commit -m "feat(persistence): add markdown export for transcripts and steward summaries"
```

---

### Task 13: Folder Scanner

**Files:**

- Create: `packages/context/src/scan-folder.ts`
- Create: `packages/context/src/__tests__/scan-folder.test.ts`
- Create: `packages/context/src/__tests__/fixtures/` (test fixtures)

- [ ] **Step 1: Create test fixtures**

Create the following directory structure:

`packages/context/src/__tests__/fixtures/sample-project/README.md`:

```markdown
# Sample Project

A test project for context pack builder.
```

`packages/context/src/__tests__/fixtures/sample-project/package.json`:

```json
{
  "name": "sample-project",
  "version": "1.0.0"
}
```

`packages/context/src/__tests__/fixtures/sample-project/src/index.ts`:

```ts
console.log("hello");
```

`packages/context/src/__tests__/fixtures/sample-project/.env.local`:

```
SECRET_KEY=supersecret123
```

`packages/context/src/__tests__/fixtures/sample-project/docs/guide.md`:

```markdown
# Guide

Some documentation.
```

- [ ] **Step 2: Write the failing test**

`packages/context/src/__tests__/scan-folder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { scanFolder } from "../scan-folder.js";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures", "sample-project");

describe("scanFolder", () => {
  it("returns list of files in directory", async () => {
    const files = await scanFolder(FIXTURES);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain("README.md");
    expect(paths).toContain("package.json");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("docs/guide.md");
  });

  it("includes file size", async () => {
    const files = await scanFolder(FIXTURES);
    const readme = files.find((f) => f.relativePath === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.bytes).toBeGreaterThan(0);
  });

  it("excludes .git internals", async () => {
    const files = await scanFolder(FIXTURES);
    const gitFiles = files.filter((f) => f.relativePath.startsWith(".git/"));
    expect(gitFiles).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run packages/context/src/__tests__/scan-folder.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement folder scanner**

`packages/context/src/scan-folder.ts`:

```ts
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ScannedFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

export async function scanFolder(targetPath: string): Promise<ScannedFile[]> {
  // Try git-tracked files first
  const gitFiles = await tryGitLsFiles(targetPath);
  if (gitFiles !== null) return gitFiles;

  // Fallback: filesystem walk
  return walkDirectory(targetPath, targetPath);
}

async function tryGitLsFiles(targetPath: string): Promise<ScannedFile[] | null> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: targetPath,
      maxBuffer: 10 * 1024 * 1024,
    });
    const paths = stdout.split("\0").filter((p) => p.length > 0);
    const files: ScannedFile[] = [];
    for (const relativePath of paths) {
      const absolutePath = join(targetPath, relativePath);
      try {
        const s = await stat(absolutePath);
        if (s.isFile()) {
          files.push({ relativePath, absolutePath, bytes: s.size });
        }
      } catch {
        // file listed by git but not on disk — skip
      }
    }
    return files;
  } catch {
    return null;
  }
}

const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  "dist",
  "build",
  ".next",
  "target",
  ".cache",
  "__pycache__",
  ".turbo",
]);

async function walkDirectory(rootPath: string, currentPath: string): Promise<ScannedFile[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files: ScannedFile[] = [];

  for (const entry of entries) {
    const fullPath = join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const subFiles = await walkDirectory(rootPath, fullPath);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const s = await stat(fullPath);
      files.push({
        relativePath: relative(rootPath, fullPath),
        absolutePath: fullPath,
        bytes: s.size,
      });
    }
  }

  return files;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/context/src/__tests__/scan-folder.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/context/
git commit -m "feat(context): add folder scanner with git-tracked preference and filesystem fallback"
```

---

### Task 14: File Selection and Priority Ranking

**Files:**

- Create: `packages/context/src/file-selection.ts`
- Create: `packages/context/src/__tests__/file-selection.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/context/src/__tests__/file-selection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { categorizeFile, isHardDenied, isDefaultExcluded, selectFiles } from "../file-selection.js";
import type { ScannedFile } from "../scan-folder.js";
import type { ContextConfig } from "@roundtable/core";

describe("categorizeFile", () => {
  it("categorizes ROUNDTABLE.md as roundtable_config", () => {
    expect(categorizeFile("ROUNDTABLE.md")).toBe("roundtable_config");
  });

  it("categorizes CLAUDE.md as agent_config", () => {
    expect(categorizeFile("CLAUDE.md")).toBe("agent_config");
  });

  it("categorizes package.json as project_meta", () => {
    expect(categorizeFile("package.json")).toBe("project_meta");
  });

  it("categorizes docs/guide.md as documentation", () => {
    expect(categorizeFile("docs/guide.md")).toBe("documentation");
  });

  it("categorizes src/index.ts as source", () => {
    expect(categorizeFile("src/index.ts")).toBe("source");
  });

  it("categorizes docker-compose.yml as config", () => {
    expect(categorizeFile("docker-compose.yml")).toBe("config");
  });
});

describe("isHardDenied", () => {
  it("denies .env files", () => {
    expect(isHardDenied(".env")).toBe(true);
    expect(isHardDenied(".env.local")).toBe(true);
    expect(isHardDenied(".env.production")).toBe(true);
  });

  it("denies key files", () => {
    expect(isHardDenied("server.pem")).toBe(true);
    expect(isHardDenied("private.key")).toBe(true);
    expect(isHardDenied("id_rsa")).toBe(true);
  });

  it("denies database files", () => {
    expect(isHardDenied("data.sqlite")).toBe(true);
    expect(isHardDenied("app.db")).toBe(true);
    expect(isHardDenied("warehouse.duckdb")).toBe(true);
  });

  it("allows normal files", () => {
    expect(isHardDenied("README.md")).toBe(false);
    expect(isHardDenied("src/index.ts")).toBe(false);
  });
});

describe("selectFiles", () => {
  const config: ContextConfig = {
    budgetBytes: 500,
    maxFiles: 10,
    maxFileBytes: 200,
    maxTreeDepth: 5,
  };

  it("selects files in priority order within budget", () => {
    const scanned: ScannedFile[] = [
      { relativePath: "src/utils.ts", absolutePath: "/p/src/utils.ts", bytes: 100 },
      { relativePath: "README.md", absolutePath: "/p/README.md", bytes: 100 },
      { relativePath: "ROUNDTABLE.md", absolutePath: "/p/ROUNDTABLE.md", bytes: 100 },
    ];
    const result = selectFiles(scanned, config);
    // ROUNDTABLE.md should come first (priority 1), then README (priority 4), then source
    expect(result.selected[0].path).toBe("ROUNDTABLE.md");
    expect(result.selected[1].path).toBe("README.md");
    expect(result.selected[2].path).toBe("src/utils.ts");
  });

  it("respects budget limit", () => {
    const scanned: ScannedFile[] = [
      { relativePath: "README.md", absolutePath: "/p/README.md", bytes: 300 },
      { relativePath: "package.json", absolutePath: "/p/package.json", bytes: 300 },
    ];
    const result = selectFiles(scanned, { ...config, budgetBytes: 400 });
    expect(result.selected).toHaveLength(1);
    expect(result.omitted.files.some((f) => f.reason === "budget_exhausted")).toBe(true);
  });

  it("hard-denies secret files regardless of includes", () => {
    const scanned: ScannedFile[] = [
      { relativePath: ".env.local", absolutePath: "/p/.env.local", bytes: 50 },
      { relativePath: "README.md", absolutePath: "/p/README.md", bytes: 100 },
    ];
    const result = selectFiles(scanned, config);
    expect(result.selected.every((f) => f.path !== ".env.local")).toBe(true);
    expect(result.omitted.files.some((f) => f.path === ".env.local")).toBe(true);
  });

  it("respects maxFiles limit", () => {
    const scanned: ScannedFile[] = Array.from({ length: 20 }, (_, i) => ({
      relativePath: `file${i}.ts`,
      absolutePath: `/p/file${i}.ts`,
      bytes: 10,
    }));
    const result = selectFiles(scanned, { ...config, maxFiles: 5 });
    expect(result.selected).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/context/src/__tests__/file-selection.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement file selection**

`packages/context/src/file-selection.ts`:

```ts
import type { ContextConfig, FileCategory, OmittedReport } from "@roundtable/core";
import type { ScannedFile } from "./scan-folder.js";
import { basename } from "node:path";

type SelectedFile = {
  path: string;
  category: FileCategory;
  bytes: number;
};

type SelectionResult = {
  selected: SelectedFile[];
  omitted: OmittedReport;
};

// Priority 1: Roundtable-specific
const ROUNDTABLE_FILES = new Set(["ROUNDTABLE.md", "COUNCIL.md"]);

// Priority 2: Agent configs
const AGENT_FILES = new Set(["AGENTS.md", "CLAUDE.md", ".cursorrules"]);

// Priority 4: Project meta
const PROJECT_META_FILES = new Set([
  "README.md",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "Makefile",
]);

// Priority 5: Infrastructure
const INFRA_FILES = new Set(["docker-compose.yml", "docker-compose.yaml", "Dockerfile", ".github"]);

const INFRA_PATTERNS = [/^\.github\//, /^\.gitlab-ci/, /Dockerfile/];

const HARD_DENY_PATTERNS = [
  /^\.env($|\.)/, // .env, .env.local, etc.
  /\.pem$/,
  /\.key$/,
  /^credentials\./,
  /^id_rsa/,
  /\.sqlite3?$/,
  /\.db$/,
  /\.duckdb$/,
];

const DEFAULT_EXCLUDE_PATTERNS = [
  /^node_modules\//,
  /^vendor\//,
  /^dist\//,
  /^build\//,
  /^\.next\//,
  /^target\//,
  /^\.cache\//,
  /^__pycache__\//,
  /^\.turbo\//,
  /pnpm-lock\.yaml$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
];

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".webp",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".pdf",
]);

export function isHardDenied(relativePath: string): boolean {
  const name = basename(relativePath);
  return HARD_DENY_PATTERNS.some((p) => p.test(name) || p.test(relativePath));
}

export function isDefaultExcluded(relativePath: string): boolean {
  const ext = relativePath.substring(relativePath.lastIndexOf(".")).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  return DEFAULT_EXCLUDE_PATTERNS.some((p) => p.test(relativePath));
}

export function categorizeFile(relativePath: string): FileCategory {
  const name = basename(relativePath);

  if (ROUNDTABLE_FILES.has(name)) return "roundtable_config";
  if (AGENT_FILES.has(name)) return "agent_config";
  if (PROJECT_META_FILES.has(name)) return "project_meta";
  if (INFRA_FILES.has(name) || INFRA_PATTERNS.some((p) => p.test(relativePath))) return "config";
  if (relativePath.startsWith("docs/") && relativePath.endsWith(".md")) return "documentation";
  return "source";
}

function priorityOf(category: FileCategory): number {
  switch (category) {
    case "roundtable_config":
      return 1;
    case "agent_config":
      return 2;
    case "project_meta":
      return 4;
    case "config":
      return 5;
    case "documentation":
      return 6;
    case "source":
      return 7;
    default:
      return 8;
  }
}

export function selectFiles(scanned: ScannedFile[], config: ContextConfig): SelectionResult {
  const selected: SelectedFile[] = [];
  const omittedFiles: { path: string; reason: string }[] = [];
  const omittedCategories = new Map<string, { count: number; reason: string }>();
  let totalBytes = 0;

  // Categorize and sort by priority
  const candidates = scanned
    .map((f) => ({
      ...f,
      category: categorizeFile(f.relativePath),
    }))
    .sort((a, b) => priorityOf(a.category) - priorityOf(b.category));

  for (const file of candidates) {
    if (isHardDenied(file.relativePath)) {
      omittedFiles.push({ path: file.relativePath, reason: "hard_denied" });
      continue;
    }

    if (isDefaultExcluded(file.relativePath)) {
      const ext = file.relativePath.substring(file.relativePath.lastIndexOf("."));
      if (BINARY_EXTENSIONS.has(ext.toLowerCase())) {
        omittedFiles.push({ path: file.relativePath, reason: "binary_file" });
      } else {
        omittedFiles.push({ path: file.relativePath, reason: "excluded_pattern" });
      }
      continue;
    }

    if (selected.length >= config.maxFiles) {
      omittedFiles.push({ path: file.relativePath, reason: "budget_exhausted" });
      continue;
    }

    if (totalBytes + file.bytes > config.budgetBytes) {
      omittedFiles.push({ path: file.relativePath, reason: "budget_exhausted" });
      continue;
    }

    selected.push({
      path: file.relativePath,
      category: file.category,
      bytes: file.bytes,
    });
    totalBytes += file.bytes;
  }

  // Build category summary for omitted
  for (const omitted of omittedFiles) {
    const key = omitted.reason;
    const existing = omittedCategories.get(key);
    if (existing) {
      existing.count++;
    } else {
      omittedCategories.set(key, { count: 1, reason: omitted.reason });
    }
  }

  return {
    selected,
    omitted: {
      categories: Array.from(omittedCategories.entries()).map(([category, data]) => ({
        category,
        ...data,
      })),
      files: omittedFiles,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/context/src/__tests__/file-selection.test.ts`
Expected: all 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/context/
git commit -m "feat(context): add file selection with priority ranking, hard-deny, and budget enforcement"
```

---

### Task 15: Redaction Pass

**Files:**

- Create: `packages/context/src/redaction.ts`
- Create: `packages/context/src/__tests__/redaction.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/context/src/__tests__/redaction.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { redactSecrets } from "../redaction.js";

describe("redactSecrets", () => {
  it("redacts API key patterns", () => {
    const input = 'const key = "sk-proj-abc123def456ghi789";\n';
    const result = redactSecrets(input);
    expect(result).not.toContain("sk-proj-abc123def456ghi789");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts private key blocks", () => {
    const input =
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC...\n-----END RSA PRIVATE KEY-----\n";
    const result = redactSecrets(input);
    expect(result).not.toContain("MIIEpAIBAAKC");
    expect(result).toContain("[REDACTED");
  });

  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx\n";
    const result = redactSecrets(input);
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts common assignment patterns", () => {
    const input = 'API_KEY="my-secret-api-key-12345"\nSECRET=verysecretvalue\n';
    const result = redactSecrets(input);
    expect(result).not.toContain("my-secret-api-key-12345");
    expect(result).not.toContain("verysecretvalue");
  });

  it("leaves normal code untouched", () => {
    const input = 'const name = "roundtable";\nconst count = 42;\n';
    const result = redactSecrets(input);
    expect(result).toBe(input);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/context/src/__tests__/redaction.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement redaction**

`packages/context/src/redaction.ts`:

```ts
const REDACTION_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Private key blocks
  {
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED: private key block]",
  },
  // Bearer tokens
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    replacement: "Bearer [REDACTED]",
  },
  // Common API key patterns (sk-..., ghp_..., etc.)
  {
    pattern: /\b(sk-[a-zA-Z0-9\-]{20,}|ghp_[a-zA-Z0-9]{36,}|ghu_[a-zA-Z0-9]{36,})\b/g,
    replacement: "[REDACTED]",
  },
  // Assignment patterns: KEY="value" or KEY=value
  {
    pattern:
      /\b(API_KEY|SECRET|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|AUTH_TOKEN|DATABASE_URL|DB_PASSWORD|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?[^\s"'\n]+["']?/gi,
    replacement: "$1=[REDACTED]",
  },
];

export function redactSecrets(content: string): string {
  let result = content;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/context/src/__tests__/redaction.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/context/
git commit -m "feat(context): add secret redaction pass for context pack content"
```

---

### Task 16: Context Pack Builder

**Files:**

- Create: `packages/context/src/build-context-pack.ts`
- Create: `packages/context/src/markdown-render.ts`
- Create: `packages/context/src/__tests__/build-context-pack.test.ts`
- Modify: `packages/context/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/context/src/__tests__/build-context-pack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildContextPack } from "../build-context-pack.js";
import { join } from "node:path";
import type { ContextConfig } from "@roundtable/core";

const FIXTURES = join(import.meta.dirname, "fixtures", "sample-project");

const config: ContextConfig = {
  budgetBytes: 100_000,
  maxFiles: 50,
  maxFileBytes: 10_000,
  maxTreeDepth: 5,
};

describe("buildContextPack", () => {
  it("builds a context pack from a directory", async () => {
    const pack = await buildContextPack(FIXTURES, config);
    expect(pack.id).toBeDefined();
    expect(pack.version).toBe(1);
    expect(pack.targetPath).toBe(FIXTURES);
    expect(pack.files.length).toBeGreaterThan(0);
    expect(pack.stats.includedFiles).toBeGreaterThan(0);
  });

  it("includes README.md", async () => {
    const pack = await buildContextPack(FIXTURES, config);
    const readme = pack.files.find((f) => f.path === "README.md");
    expect(readme).toBeDefined();
    expect(readme!.category).toBe("project_meta");
    expect(readme!.content).toContain("Sample Project");
  });

  it("excludes .env files", async () => {
    const pack = await buildContextPack(FIXTURES, config);
    const envFile = pack.files.find((f) => f.path === ".env.local");
    expect(envFile).toBeUndefined();
    const omitted = pack.omitted.files.find((f) => f.path === ".env.local");
    expect(omitted).toBeDefined();
  });

  it("redacts secrets in included files", async () => {
    // Create a fixture file with a secret pattern if not already tested
    const pack = await buildContextPack(FIXTURES, config);
    // Verify no raw secrets leak through
    for (const file of pack.files) {
      expect(file.content).not.toMatch(/^SECRET_KEY=supersecret/m);
    }
  });

  it("produces a display path", async () => {
    const pack = await buildContextPack(FIXTURES, config);
    expect(pack.displayPath).toBeDefined();
    expect(pack.displayPath).not.toBe(FIXTURES);
  });

  it("generates omitted report", async () => {
    const pack = await buildContextPack(FIXTURES, config);
    expect(pack.omitted).toBeDefined();
    expect(pack.omitted.files.length).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/context/src/__tests__/build-context-pack.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement context pack builder**

`packages/context/src/build-context-pack.ts`:

```ts
import type {
  ContextConfig,
  ContextFile,
  ContextPack,
  DirectoryTree,
  GitSummary,
} from "@roundtable/core";
import { nanoid } from "nanoid";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { scanFolder } from "./scan-folder.js";
import { selectFiles } from "./file-selection.js";
import { redactSecrets } from "./redaction.js";

const execFileAsync = promisify(execFile);

export async function buildContextPack(
  targetPath: string,
  config: ContextConfig,
  version = 1,
): Promise<ContextPack> {
  const id = `cp_${nanoid(12)}`;

  // Scan folder for files
  const scanned = await scanFolder(targetPath);

  // Gather git summary (priority 3 — before file selection consumes budget)
  const gitSummary = await gatherGitSummary(targetPath);

  // Select and prioritize files within budget
  const { selected, omitted } = selectFiles(scanned, config);

  // Read and redact file contents
  const files: ContextFile[] = [];
  for (const entry of selected) {
    const absolutePath = scanned.find((s) => s.relativePath === entry.path)?.absolutePath;
    if (!absolutePath) continue;

    let content: string;
    try {
      content = await readFile(absolutePath, "utf-8");
    } catch {
      continue;
    }

    const truncated = content.length > config.maxFileBytes;
    if (truncated) {
      content = content.slice(0, config.maxFileBytes) + "\n\n[TRUNCATED — file exceeds size limit]";
    }

    content = redactSecrets(content);

    files.push({
      path: entry.path,
      category: entry.category,
      content,
      bytes: Buffer.byteLength(content, "utf-8"),
      truncated,
    });
  }

  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);

  return {
    id,
    version,
    targetPath,
    displayPath: makeDisplayPath(targetPath),
    createdAt: new Date().toISOString(),
    config,
    tree: { name: basename(targetPath), type: "directory" },
    files,
    gitSummary,
    omitted,
    stats: {
      totalFiles: scanned.length,
      includedFiles: files.length,
      totalBytes,
      budgetBytes: config.budgetBytes,
    },
  };
}

async function gatherGitSummary(targetPath: string): Promise<GitSummary | undefined> {
  try {
    const [branchResult, statusResult, logResult, diffStatResult] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd: targetPath }),
      execFileAsync("git", ["status", "--short"], { cwd: targetPath }),
      execFileAsync("git", ["log", "--oneline", "-20", "--format=%H|%s|%aI"], { cwd: targetPath }),
      execFileAsync("git", ["diff", "--stat"], { cwd: targetPath }),
    ]);

    const recentCommits = logResult.stdout
      .trim()
      .split("\n")
      .filter((l) => l.length > 0)
      .map((line) => {
        const [hash, message, date] = line.split("|");
        return { hash, message, date };
      });

    return {
      branch: branchResult.stdout.trim(),
      status: statusResult.stdout.trim(),
      recentCommits,
      diffStat: diffStatResult.stdout.trim() || undefined,
    };
  } catch {
    return undefined; // not a git repo
  }
}

function makeDisplayPath(absolutePath: string): string {
  const home = homedir();
  if (absolutePath.startsWith(home)) {
    return "~" + absolutePath.slice(home.length);
  }
  return basename(absolutePath);
}
```

- [ ] **Step 4: Implement markdown renderer**

`packages/context/src/markdown-render.ts`:

````ts
import type { ContextPack } from "@roundtable/core";

export function renderContextPackMarkdown(pack: ContextPack): string {
  const lines: string[] = [
    "# Context Pack",
    "",
    "This is a curated, bounded snapshot of the target folder. It is not",
    "the full repository. Files were selected by priority within a budget.",
    "Omitted files are listed below.",
    "",
    "## Target",
    "",
    pack.displayPath,
    "",
    `Files: ${pack.stats.includedFiles} included, ${pack.stats.totalFiles - pack.stats.includedFiles} omitted`,
    `Size: ${pack.stats.totalBytes.toLocaleString()} bytes (budget: ${pack.stats.budgetBytes.toLocaleString()})`,
    "",
    "## Included Files",
    "",
  ];

  for (const file of pack.files) {
    lines.push(
      `### ${file.path} (${file.category})${file.truncated ? " [truncated]" : ""}`,
      "",
      "```",
      file.content,
      "```",
      "",
    );
  }

  if (pack.omitted.files.length > 0) {
    lines.push("## Omitted Files", "");
    for (const entry of pack.omitted.files) {
      lines.push(`- \`${entry.path}\`: ${entry.reason}`);
    }
    lines.push("");
  }

  if (pack.gitSummary) {
    lines.push("## Git Summary", "");
    lines.push(`Branch: ${pack.gitSummary.branch}`, "");
    if (pack.gitSummary.status) {
      lines.push("Status:", "```", pack.gitSummary.status, "```", "");
    }
    if (pack.gitSummary.recentCommits.length > 0) {
      lines.push("Recent commits:", "");
      for (const commit of pack.gitSummary.recentCommits) {
        lines.push(`- ${commit.hash.slice(0, 7)} ${commit.message}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
````

- [ ] **Step 5: Update index.ts**

`packages/context/src/index.ts`:

```ts
export { buildContextPack } from "./build-context-pack.js";
export { scanFolder } from "./scan-folder.js";
export { selectFiles, categorizeFile, isHardDenied } from "./file-selection.js";
export { redactSecrets } from "./redaction.js";
export { renderContextPackMarkdown } from "./markdown-render.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run packages/context/src/__tests__/build-context-pack.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 7: Commit**

```bash
git add packages/context/
git commit -m "feat(context): add context pack builder with scanning, selection, redaction, and markdown rendering"
```

---

## Phase 3: Engine (Milestone 4)

### Task 17: Mock Adapters

**Files:**

- Create: `packages/adapters/src/mock.ts`
- Create: `packages/adapters/src/__tests__/mock.test.ts`
- Modify: `packages/adapters/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/adapters/src/__tests__/mock.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockAdapter } from "../mock.js";
import type { AgentInput, ContextPack } from "@roundtable/core";

function makeInput(overrides?: Partial<AgentInput>): AgentInput {
  return {
    invocationId: "inv_001",
    contextPack: { id: "cp_001" } as ContextPack,
    transcript: [],
    systemPrompt: "You are Claude.",
    deliberationId: "del_001",
    ...overrides,
  };
}

describe("MockAdapter", () => {
  it("emits invocation_started, then response_end", async () => {
    const adapter = new MockAdapter({
      id: "claude",
      response: "I recommend refactoring the auth module.",
    });
    const events = [];
    for await (const event of adapter.invoke(makeInput())) {
      events.push(event);
    }
    expect(events[0].type).toBe("invocation_started");
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    expect((responseEnd as { content: string }).content).toBe(
      "I recommend refactoring the auth module.",
    );
  });

  it("emits chunks when streaming is enabled", async () => {
    const adapter = new MockAdapter({
      id: "codex",
      response: "Hello world",
      streamChunks: true,
    });
    const events = [];
    for await (const event of adapter.invoke(makeInput())) {
      events.push(event);
    }
    const chunks = events.filter((e) => e.type === "chunk");
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("simulates an error when configured", async () => {
    const adapter = new MockAdapter({
      id: "codex",
      error: "Process crashed",
    });
    const events = [];
    for await (const event of adapter.invoke(makeInput())) {
      events.push(event);
    }
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error: string }).error).toBe("Process crashed");
  });

  it("simulates a timeout when configured", async () => {
    const adapter = new MockAdapter({
      id: "claude",
      timeout: true,
    });
    const events = [];
    for await (const event of adapter.invoke(makeInput())) {
      events.push(event);
    }
    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
  });

  it("returns structured steward decision when configured", async () => {
    const decision = {
      status: "concluded" as const,
      reason: "Consensus",
      summary: "Both agree.",
    };
    const adapter = new MockAdapter({
      id: "steward",
      response: JSON.stringify(decision),
    });
    const events = [];
    for await (const event of adapter.invoke(makeInput())) {
      events.push(event);
    }
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    const parsed = JSON.parse((responseEnd as { content: string }).content);
    expect(parsed.status).toBe("concluded");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/src/__tests__/mock.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MockAdapter**

`packages/adapters/src/mock.ts`:

```ts
import type { AgentAdapter, AgentInput, AgentEvent } from "@roundtable/core";

export type MockAdapterConfig = {
  id: string;
  response?: string;
  error?: string;
  timeout?: boolean;
  delayMs?: number;
  streamChunks?: boolean;
};

export class MockAdapter implements AgentAdapter {
  id: string;
  private config: MockAdapterConfig;

  constructor(config: MockAdapterConfig) {
    this.id = config.id;
    this.config = config;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const now = new Date().toISOString();

    yield {
      type: "invocation_started",
      command: `mock-${this.id}`,
      pid: Math.floor(Math.random() * 100000),
      timestamp: now,
    };

    yield {
      type: "invocation_metadata",
      cwd: "/tmp/mock",
      command: `mock-${this.id}`,
      args: [],
      envKeys: [],
    };

    if (this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    if (signal?.aborted) {
      yield { type: "timeout", durationMs: 0, killed: true };
      return;
    }

    if (this.config.timeout) {
      yield { type: "timeout", durationMs: 120_000, killed: true };
      return;
    }

    if (this.config.error) {
      yield { type: "error", error: this.config.error, exitCode: 1 };
      return;
    }

    const content = this.config.response ?? `Mock response from ${this.id}`;

    if (this.config.streamChunks) {
      const words = content.split(" ");
      for (const word of words) {
        yield { type: "chunk", content: word + " ", stream: "stdout" };
      }
    }

    yield {
      type: "response_end",
      content,
      durationMs: this.config.delayMs ?? 100,
      exitCode: 0,
    };
  }
}
```

- [ ] **Step 4: Update index.ts**

`packages/adapters/src/index.ts`:

```ts
export { MockAdapter } from "./mock.js";
export type { MockAdapterConfig } from "./mock.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/src/__tests__/mock.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/
git commit -m "feat(adapters): add MockAdapter with configurable responses, errors, timeouts, and streaming"
```

---

### Task 18: Transcript Construction

**Files:**

- Create: `packages/core/src/transcript.ts`
- Create: `packages/core/src/__tests__/transcript.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/transcript.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildTranscript } from "../transcript.js";
import type { SessionEvent, TranscriptMessage } from "../types.js";

function makeEvent(type: string, participant: string, data: Record<string, unknown>): SessionEvent {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: type as SessionEvent["type"],
    timestamp: new Date().toISOString(),
    sessionId: "sess_001",
    participant: participant as SessionEvent["participant"],
    data,
  };
}

describe("buildTranscript", () => {
  it("includes user messages", () => {
    const events: SessionEvent[] = [
      makeEvent("user_message", "user", { content: "What should I do?" }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("user");
    expect(transcript[0].content).toBe("What should I do?");
  });

  it("includes agent responses", () => {
    const events: SessionEvent[] = [
      makeEvent("agent_response_end", "claude", {
        content: "Refactor the auth module.",
        durationMs: 3000,
        exitCode: 0,
      }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("claude");
    expect(transcript[0].content).toBe("Refactor the auth module.");
  });

  it("includes steward decisions as display text", () => {
    const events: SessionEvent[] = [
      makeEvent("steward_decision", "steward", {
        status: "concluded",
        reason: "Consensus reached",
        summary: "Both agree on refactoring.",
      }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].content).toBe("Both agree on refactoring.");
  });

  it("includes visible errors as roundtable messages", () => {
    const events: SessionEvent[] = [
      makeEvent("agent_error", "roundtable", {
        error: "Codex failed: timeout after 120s.",
      }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(1);
    expect(transcript[0].participant).toBe("roundtable");
    expect(transcript[0].content).toContain("Codex failed");
  });

  it("excludes non-display events", () => {
    const events: SessionEvent[] = [
      makeEvent("agent_invocation_started", "claude", { invocationId: "inv_001" }),
      makeEvent("agent_chunk", "claude", { content: "partial", stream: "stdout" }),
      makeEvent("engine_state_changed", "roundtable", { from: "x", to: "y", reason: "z" }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript).toHaveLength(0);
  });

  it("preserves event order", () => {
    const events: SessionEvent[] = [
      makeEvent("user_message", "user", { content: "First" }),
      makeEvent("agent_response_end", "claude", { content: "Second", durationMs: 0, exitCode: 0 }),
      makeEvent("agent_response_end", "codex", { content: "Third", durationMs: 0, exitCode: 0 }),
    ];
    const transcript = buildTranscript(events);
    expect(transcript.map((t) => t.content)).toEqual(["First", "Second", "Third"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/transcript.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement transcript construction**

`packages/core/src/transcript.ts`:

```ts
import type { SessionEvent, TranscriptMessage, StewardDecision } from "./types.js";

const DISPLAY_EVENT_TYPES = new Set([
  "user_message",
  "agent_response_end",
  "steward_decision",
  "agent_error",
]);

function extractDisplayContent(event: SessionEvent): string {
  const data = event.data;
  switch (event.type) {
    case "user_message":
      return data.content as string;
    case "agent_response_end":
      return data.content as string;
    case "steward_decision":
      return (data as unknown as StewardDecision).summary;
    case "agent_error":
      return data.error as string;
    default:
      return "";
  }
}

export function buildTranscript(events: SessionEvent[], maxBytes?: number): TranscriptMessage[] {
  const all = events
    .filter((e) => DISPLAY_EVENT_TYPES.has(e.type) && e.participant)
    .map((e) => ({
      participant: e.participant!,
      content: extractDisplayContent(e),
      timestamp: e.timestamp,
    }));

  if (!maxBytes) return all;

  // Budget enforcement: include recent messages, trim older ones
  let totalBytes = 0;
  const result: TranscriptMessage[] = [];

  // Walk from newest to oldest
  for (let i = all.length - 1; i >= 0; i--) {
    const msgBytes = Buffer.byteLength(all[i].content, "utf-8");
    if (totalBytes + msgBytes > maxBytes && result.length > 0) {
      // Prepend a notice about omitted messages
      result.unshift({
        participant: "roundtable",
        content: `[${i + 1} earlier message(s) omitted due to transcript budget]`,
        timestamp: all[0].timestamp,
      });
      break;
    }
    totalBytes += msgBytes;
    result.unshift(all[i]);
  }

  return result;
}
```

- [ ] **Step 4: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { buildTranscript } from "./transcript.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/transcript.test.ts`
Expected: all 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add transcript construction from event log"
```

---

### Task 19: Turn Loop (Deliberation State Machine)

**Files:**

- Create: `packages/core/src/turn-loop.ts`
- Create: `packages/core/src/__tests__/turn-loop.test.ts`

This is the most complex piece. The turn loop manages one deliberation: Claude -> Codex -> Steward, with hard caps, error handling, and the continue/conclude decision.

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/turn-loop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runDeliberation } from "../turn-loop.js";
import { MockAdapter } from "@roundtable/adapters";
import type {
  AgentAdapter,
  ContextPack,
  SessionEvent,
  DeliberationLimits,
  TranscriptMessage,
} from "../types.js";

const LIMITS: DeliberationLimits = {
  maxRounds: 2,
  participantTimeoutMs: 120_000,
  deliberationTimeoutMs: 600_000,
};

const MOCK_CONTEXT_PACK = { id: "cp_001" } as ContextPack;

function collectEvents(iter: AsyncIterable<SessionEvent>): Promise<SessionEvent[]> {
  return Array.fromAsync(iter);
}

describe("runDeliberation", () => {
  it("runs a full round: claude -> codex -> steward (concluded)", async () => {
    const adapters = {
      claude: new MockAdapter({ id: "claude", response: "Claude says hello" }),
      codex: new MockAdapter({ id: "codex", response: "Codex agrees" }),
      steward: new MockAdapter({
        id: "steward",
        response: JSON.stringify({
          status: "concluded",
          reason: "Consensus",
          summary: "Both agree.",
        }),
      }),
    };

    const events = await collectEvents(
      runDeliberation({
        sessionId: "sess_001",
        userMessage: "What should I do?",
        contextPack: MOCK_CONTEXT_PACK,
        priorTranscript: [],
        adapters,
        limits: LIMITS,
        systemPrompts: { claude: "Be Claude", codex: "Be Codex", steward: "Be Steward" },
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toContain("user_message");
    expect(types).toContain("deliberation_started");
    expect(types).toContain("agent_response_end");
    expect(types).toContain("steward_decision");
    expect(types).toContain("deliberation_ended");

    // Verify agent responses
    const agentResponses = events.filter((e) => e.type === "agent_response_end");
    expect(agentResponses).toHaveLength(2); // claude + codex
    expect(agentResponses[0].participant).toBe("claude");
    expect(agentResponses[1].participant).toBe("codex");
  });

  it("runs two rounds when steward says continue, then concludes", async () => {
    let stewardCallCount = 0;
    const steward: AgentAdapter = {
      id: "steward",
      async *invoke() {
        stewardCallCount++;
        const decision =
          stewardCallCount === 1
            ? { status: "continue", reason: "More discussion needed", summary: "Partial" }
            : { status: "concluded", reason: "Done", summary: "Final answer" };
        yield {
          type: "invocation_started",
          command: "mock",
          pid: 1,
          timestamp: new Date().toISOString(),
        };
        yield {
          type: "response_end",
          content: JSON.stringify(decision),
          durationMs: 100,
          exitCode: 0,
        };
      },
    };

    const events = await collectEvents(
      runDeliberation({
        sessionId: "sess_001",
        userMessage: "Discuss this",
        contextPack: MOCK_CONTEXT_PACK,
        priorTranscript: [],
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "Round response" }),
          codex: new MockAdapter({ id: "codex", response: "Round response" }),
          steward,
        },
        limits: LIMITS,
        systemPrompts: { claude: "", codex: "", steward: "" },
      }),
    );

    const agentResponses = events.filter((e) => e.type === "agent_response_end");
    expect(agentResponses).toHaveLength(4); // 2 rounds x 2 participants
    expect(stewardCallCount).toBe(2);
  });

  it("enforces max rounds even if steward says continue", async () => {
    const steward: AgentAdapter = {
      id: "steward",
      async *invoke() {
        yield {
          type: "invocation_started",
          command: "mock",
          pid: 1,
          timestamp: new Date().toISOString(),
        };
        yield {
          type: "response_end",
          content: JSON.stringify({
            status: "continue",
            reason: "Keep going",
            summary: "Not done",
          }),
          durationMs: 100,
          exitCode: 0,
        };
      },
    };

    const events = await collectEvents(
      runDeliberation({
        sessionId: "sess_001",
        userMessage: "Go",
        contextPack: MOCK_CONTEXT_PACK,
        priorTranscript: [],
        adapters: {
          claude: new MockAdapter({ id: "claude", response: "ok" }),
          codex: new MockAdapter({ id: "codex", response: "ok" }),
          steward,
        },
        limits: { ...LIMITS, maxRounds: 1 },
        systemPrompts: { claude: "", codex: "", steward: "" },
      }),
    );

    const ended = events.find((e) => e.type === "deliberation_ended");
    expect(ended).toBeDefined();
    expect(ended!.data.reason).toBe("max_rounds_reached");
  });

  it("handles adapter error and continues to next participant", async () => {
    const events = await collectEvents(
      runDeliberation({
        sessionId: "sess_001",
        userMessage: "Go",
        contextPack: MOCK_CONTEXT_PACK,
        priorTranscript: [],
        adapters: {
          claude: new MockAdapter({ id: "claude", error: "Claude crashed" }),
          codex: new MockAdapter({ id: "codex", response: "Codex works" }),
          steward: new MockAdapter({
            id: "steward",
            response: JSON.stringify({
              status: "concluded",
              reason: "Only codex responded",
              summary: "Partial result",
            }),
          }),
        },
        limits: LIMITS,
        systemPrompts: { claude: "", codex: "", steward: "" },
      }),
    );

    const errors = events.filter((e) => e.type === "agent_error");
    expect(errors.length).toBeGreaterThan(0);

    // Codex still ran
    const codexResponse = events.find(
      (e) => e.type === "agent_response_end" && e.participant === "codex",
    );
    expect(codexResponse).toBeDefined();
  });

  it("short-circuits when both claude and codex fail", async () => {
    const events = await collectEvents(
      runDeliberation({
        sessionId: "sess_001",
        userMessage: "Go",
        contextPack: MOCK_CONTEXT_PACK,
        priorTranscript: [],
        adapters: {
          claude: new MockAdapter({ id: "claude", error: "Claude crashed" }),
          codex: new MockAdapter({ id: "codex", error: "Codex crashed" }),
          steward: new MockAdapter({
            id: "steward",
            response: JSON.stringify({
              status: "concluded",
              reason: "N/A",
              summary: "N/A",
            }),
          }),
        },
        limits: LIMITS,
        systemPrompts: { claude: "", codex: "", steward: "" },
      }),
    );

    const ended = events.find((e) => e.type === "deliberation_ended");
    expect(ended).toBeDefined();
    expect(ended!.data.reason).toBe("double_failure");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/turn-loop.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the turn loop**

`packages/core/src/turn-loop.ts`:

```ts
import { nanoid } from "nanoid";
import { StewardDecisionSchema } from "./schemas.js";
import { buildTranscript } from "./transcript.js";
import type {
  AgentAdapter,
  AgentInput,
  AgentEvent,
  ContextPack,
  DeliberationLimits,
  SessionEvent,
  StewardDecision,
  TranscriptMessage,
} from "./types.js";

export type DeliberationInput = {
  sessionId: string;
  userMessage: string;
  contextPack: ContextPack;
  priorTranscript: TranscriptMessage[];
  adapters: {
    claude: AgentAdapter;
    codex: AgentAdapter;
    steward: AgentAdapter;
  };
  limits: DeliberationLimits;
  systemPrompts: {
    claude: string;
    codex: string;
    steward: string;
  };
  signal?: AbortSignal;
};

function makeEvent(
  type: SessionEvent["type"],
  sessionId: string,
  deliberationId: string,
  data: Record<string, unknown>,
  participant?: SessionEvent["participant"],
  contextPackId?: string,
): SessionEvent {
  return {
    id: `evt_${nanoid(12)}`,
    type,
    timestamp: new Date().toISOString(),
    sessionId,
    deliberationId,
    contextPackId,
    participant,
    data,
  };
}

export async function* runDeliberation(input: DeliberationInput): AsyncGenerator<SessionEvent> {
  const deliberationId = `del_${nanoid(12)}`;
  const { sessionId, contextPack, adapters, limits, systemPrompts, signal } = input;

  // Emit user message
  const userMsgEvent = makeEvent(
    "user_message",
    sessionId,
    deliberationId,
    { content: input.userMessage },
    "user",
    contextPack.id,
  );
  yield userMsgEvent;

  // Start deliberation
  yield makeEvent(
    "deliberation_started",
    sessionId,
    deliberationId,
    { userMessageEventId: userMsgEvent.id, contextPackId: contextPack.id },
    undefined,
    contextPack.id,
  );

  // Build running transcript from prior events + new events this deliberation
  const allEvents: SessionEvent[] = [];
  const getTranscript = (): TranscriptMessage[] => [
    ...input.priorTranscript,
    ...buildTranscript(allEvents),
  ];

  let round = 1;
  let endReason = "steward_concluded";

  while (round <= limits.maxRounds) {
    if (signal?.aborted) {
      yield makeEvent("deliberation_interrupted", sessionId, deliberationId, {
        reason: "user_stop",
      });
      yield makeEvent("deliberation_ended", sessionId, deliberationId, { reason: "user_stop" });
      return;
    }

    let claudeFailed = false;
    let codexFailed = false;

    // Invoke Claude
    const claudeEvents = await invokeAdapter(
      adapters.claude,
      {
        invocationId: `inv_${nanoid(12)}`,
        contextPack,
        transcript: getTranscript(),
        systemPrompt: systemPrompts.claude,
        deliberationId,
      },
      sessionId,
      deliberationId,
      "claude",
      contextPack.id,
      signal,
    );
    for (const event of claudeEvents) {
      yield event;
      allEvents.push(event);
      if (event.type === "agent_error" || event.type === "agent_invocation_timeout") {
        claudeFailed = true;
      }
    }

    // Invoke Codex
    const codexEvents = await invokeAdapter(
      adapters.codex,
      {
        invocationId: `inv_${nanoid(12)}`,
        contextPack,
        transcript: getTranscript(),
        systemPrompt: systemPrompts.codex,
        deliberationId,
      },
      sessionId,
      deliberationId,
      "codex",
      contextPack.id,
      signal,
    );
    for (const event of codexEvents) {
      yield event;
      allEvents.push(event);
      if (event.type === "agent_error" || event.type === "agent_invocation_timeout") {
        codexFailed = true;
      }
    }

    // Double failure — skip steward, end immediately
    if (claudeFailed && codexFailed) {
      endReason = "double_failure";
      break;
    }

    // Invoke Steward
    const stewardEvents = await invokeAdapter(
      adapters.steward,
      {
        invocationId: `inv_${nanoid(12)}`,
        contextPack,
        transcript: getTranscript(),
        systemPrompt: systemPrompts.steward,
        deliberationId,
      },
      sessionId,
      deliberationId,
      "steward",
      contextPack.id,
      signal,
    );

    let decision: StewardDecision | null = null;
    for (const event of stewardEvents) {
      // Try to parse steward response as structured decision
      if (event.type === "agent_response_end") {
        const parsed = StewardDecisionSchema.safeParse(
          tryParseJson((event.data as { content: string }).content),
        );
        if (parsed.success) {
          decision = parsed.data;
          const decisionEvent = makeEvent(
            "steward_decision",
            sessionId,
            deliberationId,
            decision as unknown as Record<string, unknown>,
            "steward",
            contextPack.id,
          );
          yield decisionEvent;
          allEvents.push(decisionEvent);
        } else {
          yield makeEvent(
            "steward_parse_error",
            sessionId,
            deliberationId,
            {
              rawText: (event.data as { content: string }).content,
              parseError: parsed.error.message,
            },
            "roundtable",
            contextPack.id,
          );
          endReason = "steward_parse_error";
          break;
        }
      } else {
        yield event;
        allEvents.push(event);
      }
    }

    if (!decision || decision.status === "concluded" || decision.status === "needs_user") {
      endReason = decision ? "steward_concluded" : "steward_parse_error";
      break;
    }

    if (decision.status === "continue") {
      if (round >= limits.maxRounds) {
        endReason = "max_rounds_reached";
        break;
      }
      round++;
    }
  }

  yield makeEvent("deliberation_ended", sessionId, deliberationId, {
    reason: endReason,
    rounds: round,
  });
}

async function invokeAdapter(
  adapter: AgentAdapter,
  agentInput: AgentInput,
  sessionId: string,
  deliberationId: string,
  participant: SessionEvent["participant"],
  contextPackId: string,
  signal?: AbortSignal,
): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];

  try {
    for await (const agentEvent of adapter.invoke(agentInput, signal)) {
      const sessionEvent = agentEventToSessionEvent(
        agentEvent,
        sessionId,
        deliberationId,
        participant,
        contextPackId,
      );
      events.push(sessionEvent);
    }
  } catch (err) {
    events.push(
      makeEvent(
        "agent_error",
        sessionId,
        deliberationId,
        { error: (err as Error).message },
        "roundtable",
        contextPackId,
      ),
    );
  }

  return events;
}

function agentEventToSessionEvent(
  agentEvent: AgentEvent,
  sessionId: string,
  deliberationId: string,
  participant: SessionEvent["participant"],
  contextPackId: string,
): SessionEvent {
  const typeMap: Record<AgentEvent["type"], SessionEvent["type"]> = {
    invocation_started: "agent_invocation_started",
    invocation_metadata: "agent_invocation_metadata",
    chunk: "agent_chunk",
    response_end: "agent_response_end",
    error: "agent_error",
    timeout: "agent_invocation_timeout",
    output_truncated: "output_truncated",
  };

  const eventType = typeMap[agentEvent.type];
  const { type, ...data } = agentEvent;

  // For errors, use "roundtable" as participant for visible error messages
  const eventParticipant =
    eventType === "agent_error" || eventType === "agent_invocation_timeout"
      ? "roundtable"
      : participant;

  return makeEvent(
    eventType,
    sessionId,
    deliberationId,
    data as Record<string, unknown>,
    eventParticipant,
    contextPackId,
  );
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 4: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { runDeliberation } from "./turn-loop.js";
export type { DeliberationInput } from "./turn-loop.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/turn-loop.test.ts`
Expected: all 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add deliberation turn loop with state machine, hard caps, and error handling"
```

---

### Task 20: RoundtableEngine Orchestrator

**Files:**

- Create: `packages/core/src/engine.ts`
- Create: `packages/core/src/__tests__/engine.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/__tests__/engine.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine } from "../engine.js";
import { MockAdapter } from "@roundtable/adapters";
import { FileSessionStore } from "@roundtable/persistence";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RoundtableConfig, ContextPack } from "../types.js";

function makeConfig(dataDir: string): RoundtableConfig {
  return {
    dataDir,
    context: { budgetBytes: 100_000, maxFiles: 50, maxFileBytes: 10_000, maxTreeDepth: 5 },
    deliberation: {
      maxRounds: 2,
      participantTimeoutMs: 120_000,
      deliberationTimeoutMs: 600_000,
    },
    adapters: {
      claude: {
        command: "claude",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      codex: {
        command: "codex",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      steward: {
        command: "claude",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
    },
  };
}

describe("RoundtableEngine", () => {
  let dataDir: string;
  let engine: RoundtableEngine;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `rt-engine-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });

    const store = new FileSessionStore(dataDir);
    const adapters = {
      claude: new MockAdapter({ id: "claude", response: "Claude's analysis" }),
      codex: new MockAdapter({ id: "codex", response: "Codex's analysis" }),
      steward: new MockAdapter({
        id: "steward",
        response: JSON.stringify({
          status: "concluded",
          reason: "Consensus reached",
          summary: "Both recommend refactoring.",
        }),
      }),
    };

    engine = new RoundtableEngine({
      store,
      adapters,
      config: makeConfig(dataDir),
    });
  });

  it("starts a session and runs a deliberation", async () => {
    const mockContextPack = { id: "cp_test", version: 1 } as ContextPack;
    const session = await engine.startSession("/tmp/test-project", mockContextPack);
    expect(session.meta.status).toBe("awaiting_user");

    const events = [];
    for await (const event of engine.submitMessage(session, "What should we refactor?")) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type);
    expect(types).toContain("user_message");
    expect(types).toContain("steward_decision");
    expect(types).toContain("deliberation_ended");
  });

  it("persists events after deliberation", async () => {
    const mockContextPack = {
      id: "cp_test",
      version: 1,
      stats: { includedFiles: 1, totalBytes: 100 },
    } as ContextPack;
    const session = await engine.startSession("/tmp/test-project", mockContextPack);

    // Session start emits session_started + context_pack_built
    expect(session.events).toHaveLength(2);
    expect(session.events[0].type).toBe("session_started");
    expect(session.events[1].type).toBe("context_pack_built");

    const deliberationEvents = [];
    for await (const event of engine.submitMessage(session, "Test message")) {
      deliberationEvents.push(event);
    }

    // Reload events from store — includes lifecycle + deliberation events
    const store = new FileSessionStore(dataDir);
    const storedEvents = await store.loadEvents(session.meta.id);
    expect(storedEvents.length).toBe(2 + deliberationEvents.length);
  });

  it("resumes a session", async () => {
    const mockContextPack = { id: "cp_test", version: 1 } as ContextPack;
    const session = await engine.startSession("/tmp/test-project", mockContextPack);

    // Run first deliberation
    for await (const _ of engine.submitMessage(session, "First question")) {
      // consume
    }

    // Resume
    const resumed = await engine.resumeSession(session.meta.id);
    expect(resumed.meta.id).toBe(session.meta.id);
    expect(resumed.events.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/core/src/__tests__/engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement RoundtableEngine**

`packages/core/src/engine.ts`:

```ts
import { nanoid } from "nanoid";
import { runDeliberation } from "./turn-loop.js";
import { buildTranscript } from "./transcript.js";
import type {
  AgentAdapter,
  ContextPack,
  RoundtableConfig,
  Session,
  SessionEvent,
  SessionMeta,
  SessionStore,
} from "./types.js";

export type EngineOptions = {
  store: SessionStore;
  adapters: {
    claude: AgentAdapter;
    codex: AgentAdapter;
    steward: AgentAdapter;
  };
  config: RoundtableConfig;
  systemPrompts?: {
    claude: string;
    codex: string;
    steward: string;
  };
};

const DEFAULT_PROMPTS = {
  claude: "You are Claude, participating in a Roundtable deliberation. Respond thoughtfully.",
  codex: "You are Codex, participating in a Roundtable deliberation. Respond thoughtfully.",
  steward: `You are the Steward, a moderator in a Roundtable deliberation.
Evaluate the transcript and return a JSON object with this shape:
{
  "status": "concluded" | "continue" | "needs_user",
  "reason": "why this status",
  "summary": "summary of the deliberation so far"
}
Respond ONLY with the JSON object, no other text.`,
};

export class RoundtableEngine {
  private store: SessionStore;
  private adapters: EngineOptions["adapters"];
  private config: RoundtableConfig;
  private systemPrompts: { claude: string; codex: string; steward: string };

  constructor(options: EngineOptions) {
    this.store = options.store;
    this.adapters = options.adapters;
    this.config = options.config;
    this.systemPrompts = options.systemPrompts ?? DEFAULT_PROMPTS;
  }

  async startSession(targetPath: string, contextPack: ContextPack): Promise<Session> {
    const id = `rt_${nanoid(16)}`;
    const now = new Date().toISOString();

    const meta: SessionMeta = {
      id,
      status: "awaiting_user",
      targetPath,
      createdAt: now,
      updatedAt: now,
      currentContextPackId: contextPack.id,
      configSnapshot: this.config,
      participants: [
        { id: "user", adapter: "user" },
        { id: "claude", adapter: "claude" },
        { id: "codex", adapter: "codex" },
        { id: "steward", adapter: "steward" },
      ],
    };

    await this.store.createSession(meta);
    await this.store.saveContextPack(id, contextPack);

    // Emit lifecycle events
    const sessionStartedEvent: SessionEvent = {
      id: `evt_${nanoid(12)}`,
      type: "session_started",
      timestamp: now,
      sessionId: id,
      data: { targetPath, contextPackId: contextPack.id },
    };
    await this.store.appendEvent(id, sessionStartedEvent);

    const contextBuiltEvent: SessionEvent = {
      id: `evt_${nanoid(12)}`,
      type: "context_pack_built",
      timestamp: now,
      sessionId: id,
      contextPackId: contextPack.id,
      data: {
        contextPackId: contextPack.id,
        version: contextPack.version,
        fileCount: contextPack.stats.includedFiles,
        totalBytes: contextPack.stats.totalBytes,
      },
    };
    await this.store.appendEvent(id, contextBuiltEvent);

    return { meta, events: [sessionStartedEvent, contextBuiltEvent] };
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const meta = await this.store.loadSession(sessionId);
    const events = await this.store.loadEvents(sessionId);
    return { meta, events };
  }

  async refreshContext(session: Session, contextPack: ContextPack): Promise<ContextPack> {
    await this.store.saveContextPack(session.meta.id, contextPack);

    const event: SessionEvent = {
      id: `evt_${nanoid(12)}`,
      type: "context_pack_built",
      timestamp: new Date().toISOString(),
      sessionId: session.meta.id,
      contextPackId: contextPack.id,
      data: {
        contextPackId: contextPack.id,
        version: contextPack.version,
        fileCount: contextPack.stats.includedFiles,
        totalBytes: contextPack.stats.totalBytes,
      },
    };
    await this.store.appendEvent(session.meta.id, event);
    session.events.push(event);

    await this.store.updateMeta(session.meta.id, {
      currentContextPackId: contextPack.id,
      updatedAt: new Date().toISOString(),
    });
    session.meta.currentContextPackId = contextPack.id;

    return contextPack;
  }

  async *submitMessage(
    session: Session,
    message: string,
    signal?: AbortSignal,
  ): AsyncGenerator<SessionEvent> {
    await this.store.updateMeta(session.meta.id, { status: "deliberating" });

    const contextPack = await this.store.loadContextPack(
      session.meta.id,
      session.meta.currentContextPackId,
    );

    const priorTranscript = buildTranscript(
      session.events,
      this.config.deliberation.maxTranscriptBytes,
    );

    for await (const event of runDeliberation({
      sessionId: session.meta.id,
      userMessage: message,
      contextPack,
      priorTranscript,
      adapters: this.adapters,
      limits: this.config.deliberation,
      systemPrompts: this.systemPrompts,
      signal,
    })) {
      // Persist each event
      await this.store.appendEvent(session.meta.id, event);
      session.events.push(event);

      // Update meta on steward decisions
      if (event.type === "steward_decision") {
        const summary = (event.data as { summary?: string }).summary;
        if (summary) {
          await this.store.updateMeta(session.meta.id, {
            latestStewardSummary: summary,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      yield event;
    }

    await this.store.updateMeta(session.meta.id, {
      status: "awaiting_user",
      updatedAt: new Date().toISOString(),
    });
  }

  async archiveSession(session: Session): Promise<void> {
    const event: SessionEvent = {
      id: `evt_${nanoid(12)}`,
      type: "session_archived",
      timestamp: new Date().toISOString(),
      sessionId: session.meta.id,
      data: {},
    };
    await this.store.appendEvent(session.meta.id, event);

    await this.store.updateMeta(session.meta.id, {
      status: "archived",
      updatedAt: new Date().toISOString(),
    });
  }
}
```

- [ ] **Step 4: Update core index.ts**

Add to `packages/core/src/index.ts`:

```ts
export { RoundtableEngine } from "./engine.js";
export type { EngineOptions } from "./engine.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/core/src/__tests__/engine.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/
git commit -m "feat(core): add RoundtableEngine orchestrator with session lifecycle and event persistence"
```

---

## Phase 4: CLI (Milestone 5)

### Task 21: CLI Command Structure

**Files:**

- Modify: `apps/cli/src/index.ts`
- Create: `apps/cli/src/commands/convene.ts`
- Create: `apps/cli/src/commands/sessions.ts`
- Create: `apps/cli/src/commands/show.ts`
- Create: `apps/cli/src/commands/config.ts`

- [ ] **Step 1: Set up Commander program with all commands**

`apps/cli/src/index.ts`:

```ts
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
```

- [ ] **Step 2: Create convene command skeleton**

`apps/cli/src/commands/convene.ts`:

```ts
import { Command } from "commander";

export const conveneCommand = new Command("convene")
  .description("Start or resume a deliberation")
  .argument("[path]", "Target folder path")
  .argument("[message]", "Initial message")
  .option("--session <id>", "Resume an existing session")
  .option("--once", "Run one deliberation and exit")
  .option("--max-rounds <n>", "Max deliberation rounds", parseInt)
  .option("--context-budget <n>", "Context budget in bytes", parseInt)
  .option("--max-files <n>", "Max files in context pack", parseInt)
  .option(
    "--include <glob>",
    "Include pattern",
    (val: string, prev: string[]) => [...prev, val],
    [],
  )
  .option(
    "--exclude <glob>",
    "Exclude pattern",
    (val: string, prev: string[]) => [...prev, val],
    [],
  )
  .option("--no-stream", "Disable streaming output")
  .option("--timeout <ms>", "Per-participant timeout in ms", parseInt)
  .option("--verbose", "Show invocation metadata")
  .option("--dry-run", "Preview context pack without invoking")
  .option("--mock", "Use mock adapters for testing")
  .action(async (path, message, options) => {
    // Validate: --session and path are mutually exclusive
    if (options.session && path) {
      console.error("Error: --session and <path> are mutually exclusive.");
      process.exit(1);
    }
    if (!options.session && !path) {
      console.error("Error: either <path> or --session <id> is required.");
      process.exit(1);
    }

    console.log("convene: not yet implemented");
    console.log({ path, message, options });
  });
```

- [ ] **Step 3: Create sessions command skeleton**

`apps/cli/src/commands/sessions.ts`:

```ts
import { Command } from "commander";

export const sessionsCommand = new Command("sessions").description("Manage sessions");

sessionsCommand
  .command("list")
  .description("List past sessions")
  .action(async () => {
    console.log("sessions list: not yet implemented");
  });

sessionsCommand
  .command("archive <id>")
  .description("Archive a session")
  .action(async (id) => {
    console.log(`sessions archive ${id}: not yet implemented`);
  });
```

- [ ] **Step 4: Create show command skeleton**

`apps/cli/src/commands/show.ts`:

```ts
import { Command } from "commander";

export const showCommand = new Command("show")
  .description("Show session transcript")
  .argument("[session-id]", "Session ID to show")
  .option("--latest", "Show most recent session")
  .option("--regenerate", "Regenerate transcript from events")
  .action(async (sessionId, options) => {
    if (!sessionId && !options.latest) {
      console.error("Error: provide a session ID or use --latest.");
      process.exit(1);
    }
    console.log("show: not yet implemented");
  });
```

- [ ] **Step 5: Create config command skeleton**

`apps/cli/src/commands/config.ts`:

```ts
import { Command } from "commander";

export const configCommand = new Command("config").description("Manage configuration");

configCommand
  .command("show")
  .description("Show resolved configuration")
  .action(async () => {
    console.log("config show: not yet implemented");
  });

configCommand
  .command("init")
  .description("Generate a roundtable.config.yaml template")
  .action(async () => {
    console.log("config init: not yet implemented");
  });
```

- [ ] **Step 6: Verify CLI runs**

Run: `node --import tsx apps/cli/src/index.ts --help`
Expected: shows help with convene, sessions, show, config commands

Run: `node --import tsx apps/cli/src/index.ts convene --help`
Expected: shows convene options

- [ ] **Step 7: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): add command structure with convene, sessions, show, and config commands"
```

---

### Task 22: Display Renderer

**Files:**

- Create: `apps/cli/src/render.ts`

- [ ] **Step 1: Implement the event renderer**

`apps/cli/src/render.ts`:

```ts
import type { SessionEvent } from "@roundtable/core";

const PARTICIPANT_LABELS: Record<string, string> = {
  user: "You",
  claude: "Claude",
  codex: "Codex",
  steward: "Steward",
  roundtable: "Roundtable",
};

export type RenderOptions = {
  verbose: boolean;
  stream: boolean;
};

let lastParticipant: string | undefined;

export function renderEvent(event: SessionEvent, options: RenderOptions): void {
  switch (event.type) {
    case "user_message":
      printHeader("user");
      console.log((event.data as { content: string }).content);
      console.log();
      break;

    case "agent_chunk":
      if (options.stream && event.participant) {
        printHeaderIfNew(event.participant);
        process.stdout.write((event.data as { content: string }).content);
      }
      break;

    case "agent_response_end":
      if (event.participant) {
        if (!options.stream) {
          printHeader(event.participant);
          console.log((event.data as { content: string }).content);
        } else {
          // End the streaming line
          console.log();
        }
        console.log();
        if (options.verbose) {
          const data = event.data as { durationMs: number };
          console.log(`  (${(data.durationMs / 1000).toFixed(1)}s)`);
        }
      }
      break;

    case "steward_decision": {
      printHeader("steward");
      const data = event.data as { summary: string; status: string };
      console.log(data.summary);
      console.log();
      break;
    }

    case "agent_error":
      if (event.participant) {
        printHeader(event.participant);
        console.log((event.data as { error: string }).error);
        console.log();
      }
      break;

    case "deliberation_started":
      if (options.verbose) {
        console.log("--- Deliberation started ---");
        console.log();
      }
      break;

    case "deliberation_ended":
      if (options.verbose) {
        const data = event.data as { reason: string; rounds: number };
        console.log(`--- Deliberation ended (${data.reason}, ${data.rounds} round(s)) ---`);
        console.log();
      }
      break;

    case "agent_invocation_started":
      if (options.verbose) {
        const data = event.data as { command: string; pid: number };
        console.log(`  [${event.participant}: pid ${data.pid}]`);
      }
      break;
  }
}

function printHeader(participant: string): void {
  const label = PARTICIPANT_LABELS[participant] ?? participant;
  console.log(`${label}:`);
  lastParticipant = participant;
}

function printHeaderIfNew(participant: string): void {
  if (participant !== lastParticipant) {
    printHeader(participant);
  }
}

export function resetRenderer(): void {
  lastParticipant = undefined;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/src/render.ts
git commit -m "feat(cli): add terminal event renderer with streaming and verbose modes"
```

---

### Task 23: Interactive Mode and Convene Wiring

**Files:**

- Create: `apps/cli/src/interactive.ts`
- Create: `apps/cli/src/prompts.ts`
- Modify: `apps/cli/src/commands/convene.ts`

- [ ] **Step 1: Create system prompts**

`apps/cli/src/prompts.ts`:

```ts
export const CLAUDE_SYSTEM_PROMPT = `You are Claude, participating in a Roundtable deliberation. You are in READ-ONLY mode.

You MUST NOT:
- Write, create, modify, or delete any files
- Execute shell commands, scripts, or tools
- Run package managers (npm, pip, cargo, etc.)
- Perform git operations that mutate state (commit, push, rebase, etc.)
- Modify any system configuration

You MUST NOT request or perform external network fetches, scraping, package downloads, API calls, or service mutations.

You have been provided a curated context pack from the target project. This is your only source of information about the project. You do not have filesystem access.

Respond thoughtfully to the user's question and engage with other participants' views.`;

export const CODEX_SYSTEM_PROMPT = `You are Codex, participating in a Roundtable deliberation. You are in READ-ONLY mode.

You MUST NOT:
- Write, create, modify, or delete any files
- Execute shell commands, scripts, or tools
- Run package managers (npm, pip, cargo, etc.)
- Perform git operations that mutate state (commit, push, rebase, etc.)
- Modify any system configuration

You MUST NOT request or perform external network fetches, scraping, package downloads, API calls, or service mutations.

You have been provided a curated context pack from the target project. This is your only source of information about the project. You do not have filesystem access.

Respond thoughtfully to the user's question and engage with other participants' views.`;

export const STEWARD_SYSTEM_PROMPT = `You are the Steward, a moderator in a Roundtable deliberation. You are in READ-ONLY mode.

Evaluate the transcript and determine whether the deliberation has reached a useful conclusion.

You MUST NOT approve or authorize any write, mutation, or execution action.
You MUST NOT escalate permissions beyond read-only.
You MUST NOT direct participants to perform actions outside the deliberation.

Respond ONLY with a JSON object matching this exact schema:
{
  "status": "concluded" | "continue" | "needs_user",
  "reason": "brief explanation of why this status",
  "summary": "summary of the deliberation and key points"
}

Use "concluded" when participants have reached consensus or a clear recommendation.
Use "continue" when there is productive disagreement worth another round.
Use "needs_user" when the participants need clarification from the user.`;
```

- [ ] **Step 2: Create interactive mode handler**

`apps/cli/src/interactive.ts`:

```ts
import { createInterface } from "node:readline";
import type { Session } from "@roundtable/core";
import type { RoundtableEngine } from "@roundtable/core";
import { generateTranscriptMarkdown } from "@roundtable/persistence";
import { buildContextPack } from "@roundtable/context";
import { renderEvent, resetRenderer } from "./render.js";
import type { RenderOptions } from "./render.js";

export type InteractiveOptions = {
  engine: RoundtableEngine;
  session: Session;
  renderOptions: RenderOptions;
  once: boolean;
};

export async function runInteractive(options: InteractiveOptions): Promise<void> {
  const { engine, session, renderOptions, once } = options;
  const controller = new AbortController();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () =>
    new Promise<string | null>((resolve) => {
      rl.question("You: ", (answer) => {
        resolve(answer || null);
      });
    });

  // Handle Ctrl+C
  let deliberating = false;
  process.on("SIGINT", () => {
    if (deliberating) {
      controller.abort();
      deliberating = false;
    } else {
      rl.close();
      process.exit(0);
    }
  });

  while (true) {
    resetRenderer();
    const input = await prompt();

    if (input === null) continue;

    // Slash commands
    if (input === "/exit") break;
    if (input === "/help") {
      printHelp();
      continue;
    }
    if (input === "/status") {
      console.log(`Session: ${session.meta.id}`);
      console.log(`Target: ${session.meta.targetPath}`);
      console.log(`Context pack: ${session.meta.currentContextPackId}`);
      console.log();
      continue;
    }
    if (input === "/transcript") {
      const md = generateTranscriptMarkdown(session.events, session.meta.id);
      console.log(md);
      continue;
    }
    if (input === "/refresh-context") {
      console.log("Rebuilding context pack...");
      const newPack = await buildContextPack(
        session.meta.targetPath,
        session.meta.configSnapshot.context,
        (session.meta.currentContextPackId.match(/v(\d+)/) ? parseInt(RegExp.$1) : 0) + 1,
      );
      await engine.refreshContext(session, newPack);
      console.log(
        `done (${newPack.stats.includedFiles} files, ${(newPack.stats.totalBytes / 1024).toFixed(0)}KB)`,
      );
      console.log(`Context pack updated: ${newPack.id}`);
      console.log();
      continue;
    }
    if (input.startsWith("/")) {
      console.log(`Unknown command: ${input}. Type /help for available commands.`);
      console.log();
      continue;
    }

    if (input.trim().length === 0) continue;

    // Run deliberation
    deliberating = true;
    console.log();
    try {
      for await (const event of engine.submitMessage(session, input, controller.signal)) {
        renderEvent(event, renderOptions);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error(`Roundtable: Deliberation failed: ${(err as Error).message}`);
      }
    }
    deliberating = false;

    if (once) break;
  }

  rl.close();
}

function printHelp(): void {
  console.log("Available commands:");
  console.log("  /exit              Leave the room");
  console.log("  /stop              Interrupt current deliberation");
  console.log("  /status            Show session info");
  console.log("  /refresh-context   Rebuild context pack");
  console.log("  /transcript        Regenerate and display transcript");
  console.log("  /help              Show this help");
  console.log();
}
```

- [ ] **Step 3: Wire convene command**

Replace `apps/cli/src/commands/convene.ts` with the full implementation:

```ts
import { Command } from "commander";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import { RoundtableEngine } from "@roundtable/core";
import { resolveConfig } from "@roundtable/config";
import { FileSessionStore } from "@roundtable/persistence";
import { buildContextPack, renderContextPackMarkdown } from "@roundtable/context";
import { MockAdapter } from "@roundtable/adapters";
import { runInteractive } from "../interactive.js";
import { renderEvent } from "../render.js";
import { CLAUDE_SYSTEM_PROMPT, CODEX_SYSTEM_PROMPT, STEWARD_SYSTEM_PROMPT } from "../prompts.js";

export const conveneCommand = new Command("convene")
  .description("Start or resume a deliberation")
  .argument("[path]", "Target folder path")
  .argument("[message]", "Initial message")
  .option("--session <id>", "Resume an existing session")
  .option("--once", "Run one deliberation and exit")
  .option("--max-rounds <n>", "Max deliberation rounds", parseInt)
  .option("--context-budget <n>", "Context budget in bytes", parseInt)
  .option("--max-files <n>", "Max files in context pack", parseInt)
  .option(
    "--include <glob>",
    "Include pattern",
    (val: string, prev: string[]) => [...prev, val],
    [],
  )
  .option(
    "--exclude <glob>",
    "Exclude pattern",
    (val: string, prev: string[]) => [...prev, val],
    [],
  )
  .option("--no-stream", "Disable streaming output")
  .option("--timeout <ms>", "Per-participant timeout in ms", parseInt)
  .option("--verbose", "Show invocation metadata")
  .option("--dry-run", "Preview context pack without invoking")
  .option("--mock", "Use mock adapters for testing")
  .action(async (path, message, options) => {
    if (options.session && path) {
      console.error("Error: --session and <path> are mutually exclusive.");
      process.exit(1);
    }
    if (!options.session && !path) {
      console.error("Error: either <path> or --session <id> is required.");
      process.exit(1);
    }

    // Build config from CLI flags
    const cliOverrides: Record<string, unknown> = {};
    if (options.maxRounds) {
      (cliOverrides.deliberation ??= {} as Record<string, unknown>) as Record<string, unknown>;
      (cliOverrides as { deliberation: Record<string, unknown> }).deliberation = {
        maxRounds: options.maxRounds,
      };
    }
    const contextOverrides: Record<string, unknown> = {};
    if (options.contextBudget) contextOverrides.budgetBytes = options.contextBudget;
    if (options.maxFiles) contextOverrides.maxFiles = options.maxFiles;
    if (options.include?.length) contextOverrides.includes = options.include;
    if (options.exclude?.length) contextOverrides.excludes = options.exclude;
    if (Object.keys(contextOverrides).length > 0) {
      (cliOverrides as { context: Record<string, unknown> }).context = contextOverrides;
    }

    const config = resolveConfig({
      env: process.env as Record<string, string>,
      cliOverrides,
    });

    if (options.timeout) {
      config.deliberation.participantTimeoutMs = options.timeout;
    }

    const store = new FileSessionStore(config.dataDir);

    // Create adapters (mock or real)
    const adapters = options.mock
      ? {
          claude: new MockAdapter({
            id: "claude",
            response:
              "This is a mock Claude response. In a real session, Claude would analyze the context pack and provide thoughtful feedback.",
            streamChunks: options.stream !== false,
          }),
          codex: new MockAdapter({
            id: "codex",
            response:
              "This is a mock Codex response. In a real session, Codex would provide an independent analysis.",
            streamChunks: options.stream !== false,
          }),
          steward: new MockAdapter({
            id: "steward",
            response: JSON.stringify({
              status: "concluded",
              reason: "Mock deliberation complete",
              summary:
                "Both mock participants provided placeholder responses. Use real adapters for actual deliberation.",
            }),
          }),
        }
      : (() => {
          console.error("Error: real adapters not yet implemented. Use --mock for testing.");
          process.exit(1);
        })();

    const engine = new RoundtableEngine({
      store,
      adapters,
      config,
      systemPrompts: {
        claude: CLAUDE_SYSTEM_PROMPT,
        codex: CODEX_SYSTEM_PROMPT,
        steward: STEWARD_SYSTEM_PROMPT,
      },
    });

    const renderOptions = {
      verbose: options.verbose ?? false,
      stream: options.stream !== false,
    };

    if (options.session) {
      // Resume session
      const session = await engine.resumeSession(options.session);
      console.log(`Resumed session ${session.meta.id}`);
      if (session.meta.latestStewardSummary) {
        console.log(`\nLast Steward summary: ${session.meta.latestStewardSummary}\n`);
      }

      if (message) {
        for await (const event of engine.submitMessage(session, message)) {
          renderEvent(event, renderOptions);
        }
        if (options.once) return;
      }

      await runInteractive({ engine, session, renderOptions, once: options.once ?? false });
      return;
    }

    // New session
    const targetPath = resolve(path);
    try {
      const s = await stat(targetPath);
      if (!s.isDirectory()) {
        console.error(`Error: ${targetPath} is not a directory.`);
        process.exit(1);
      }
    } catch {
      console.error(`Error: ${targetPath} not found.`);
      process.exit(1);
    }

    console.log("Building context pack...");
    const contextPack = await buildContextPack(targetPath, config.context);
    console.log(
      `done (${contextPack.stats.includedFiles} files, ${(contextPack.stats.totalBytes / 1024).toFixed(0)}KB)`,
    );

    if (options.dryRun) {
      console.log();
      console.log(`Context pack built:`);
      console.log(`  Target: ${contextPack.displayPath}`);
      console.log(
        `  Files: ${contextPack.stats.includedFiles} included, ${contextPack.stats.totalFiles - contextPack.stats.includedFiles} omitted`,
      );
      console.log(
        `  Size: ${contextPack.stats.totalBytes.toLocaleString()} bytes (budget: ${contextPack.stats.budgetBytes.toLocaleString()})`,
      );
      console.log();
      if (contextPack.files.length > 0) {
        console.log("Included files:");
        for (const f of contextPack.files) {
          console.log(
            `  [${f.category}] ${f.path} (${(f.bytes / 1024).toFixed(1)}KB)${f.truncated ? " [truncated]" : ""}`,
          );
        }
        console.log();
      }
      if (contextPack.omitted.files.length > 0) {
        console.log("Omitted:");
        for (const f of contextPack.omitted.files.slice(0, 20)) {
          console.log(`  ${f.path}: ${f.reason}`);
        }
        if (contextPack.omitted.files.length > 20) {
          console.log(`  ... and ${contextPack.omitted.files.length - 20} more`);
        }
      }
      console.log();
      console.log("Would invoke: Claude, Codex, Steward");
      return;
    }

    const session = await engine.startSession(targetPath, contextPack);
    console.log(`Session ${session.meta.id} started`);
    console.log();

    if (message) {
      for await (const event of engine.submitMessage(session, message)) {
        renderEvent(event, renderOptions);
      }
      if (options.once) return;
    }

    await runInteractive({ engine, session, renderOptions, once: options.once ?? false });
  });
```

- [ ] **Step 4: Verify CLI works with --mock**

Run: `node --import tsx apps/cli/src/index.ts convene . "Hello" --once --mock`
Expected: Builds context pack, runs mock deliberation, prints output, exits

- [ ] **Step 5: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): wire convene command with interactive mode, mock adapters, and dry-run"
```

---

### Task 24: Sessions and Show Commands

**Files:**

- Modify: `apps/cli/src/commands/sessions.ts`
- Modify: `apps/cli/src/commands/show.ts`

- [ ] **Step 1: Implement sessions list and archive**

Replace `apps/cli/src/commands/sessions.ts`:

```ts
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
    console.log("Sessions:");
    console.log();
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
      await store.updateMeta(id, {
        status: "archived",
        updatedAt: new Date().toISOString(),
      });
      console.log(`Session ${id} archived.`);
    } catch (err) {
      console.error(`Error: could not archive session ${id}: ${(err as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Implement show command**

Replace `apps/cli/src/commands/show.ts`:

```ts
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
  .action(async (sessionId, options) => {
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
      const events = await store.loadEvents(sessionId);
      const md = generateTranscriptMarkdown(events, sessionId);
      console.log(md);
    } catch (err) {
      console.error(`Error: could not load session ${sessionId}: ${(err as Error).message}`);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Verify commands work**

Run: `node --import tsx apps/cli/src/index.ts sessions list`
Expected: "No sessions found." (or lists sessions if any exist)

- [ ] **Step 4: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): implement sessions list/archive and show commands"
```

---

### Task 25: Mock-Based Acceptance Test

**Files:**

- Create: `apps/cli/src/__tests__/acceptance.test.ts`
- Create test fixture directory

- [ ] **Step 1: Create a test fixture**

`packages/context/src/__tests__/fixtures/sample-project/ROUNDTABLE.md`:

```markdown
# Roundtable Context

This project is a sample for testing Roundtable's context pack builder.
```

- [ ] **Step 2: Write the acceptance test**

`apps/cli/src/__tests__/acceptance.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { RoundtableEngine } from "@roundtable/core";
import { MockAdapter } from "@roundtable/adapters";
import { FileSessionStore } from "@roundtable/persistence";
import { buildContextPack } from "@roundtable/context";
import { resolveConfig } from "@roundtable/config";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("acceptance: mock-backed deliberation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `rt-acceptance-${randomUUID()}`);
    await mkdir(dataDir, { recursive: true });
  });

  it("runs a full deliberation cycle end-to-end", async () => {
    const config = resolveConfig({ cliOverrides: { dataDir } });
    const store = new FileSessionStore(dataDir);
    const adapters = {
      claude: new MockAdapter({
        id: "claude",
        response: "I recommend focusing on the core module first.",
      }),
      codex: new MockAdapter({
        id: "codex",
        response: "Agreed, the core module is the priority.",
      }),
      steward: new MockAdapter({
        id: "steward",
        response: JSON.stringify({
          status: "concluded",
          reason: "Both participants agree on priorities",
          summary:
            "Consensus: focus on the core module. Both Claude and Codex recommend starting there.",
        }),
      }),
    };

    const engine = new RoundtableEngine({ store, adapters, config });

    // Build context pack from fixtures
    const fixturesPath = join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "packages",
      "context",
      "src",
      "__tests__",
      "fixtures",
      "sample-project",
    );
    const contextPack = await buildContextPack(fixturesPath, config.context);
    expect(contextPack.files.length).toBeGreaterThan(0);

    // Start session
    const session = await engine.startSession(fixturesPath, contextPack);
    expect(session.meta.status).toBe("awaiting_user");
    expect(session.meta.id).toMatch(/^rt_/);

    // Run deliberation
    const events = [];
    for await (const event of engine.submitMessage(session, "What should I work on?")) {
      events.push(event);
    }

    // Verify event sequence
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("user_message");
    expect(types).toContain("deliberation_started");
    expect(types).toContain("agent_response_end");
    expect(types).toContain("steward_decision");
    expect(types).toContain("deliberation_ended");

    // Verify responses
    const claudeResponse = events.find(
      (e) => e.type === "agent_response_end" && e.participant === "claude",
    );
    expect(claudeResponse).toBeDefined();
    expect((claudeResponse!.data as { content: string }).content).toContain("core module");

    // Verify persistence
    const storedEvents = await store.loadEvents(session.meta.id);
    expect(storedEvents.length).toBe(events.length);

    // Verify session meta updated
    const meta = await store.loadSession(session.meta.id);
    expect(meta.latestStewardSummary).toContain("Consensus");
    expect(meta.status).toBe("awaiting_user"); // returned to awaiting after deliberation
  });
});
```

- [ ] **Step 3: Run acceptance test**

Run: `pnpm vitest run apps/cli/src/__tests__/acceptance.test.ts`
Expected: PASS

- [ ] **Step 4: Run full test suite**

Run: `pnpm test`
Expected: all tests PASS across all packages

- [ ] **Step 5: Commit**

```bash
git add apps/ packages/
git commit -m "feat: add mock-backed acceptance test proving full product loop"
```

---

## Phase 5: Integration (Milestones 6-7)

### Task 26: Base CLI Agent Process Spawner

**Files:**

- Create: `packages/adapters/src/cli-agent.ts`
- Create: `packages/adapters/src/__tests__/cli-agent.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/adapters/src/__tests__/cli-agent.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spawnCliAgent } from "../cli-agent.js";

describe("spawnCliAgent", () => {
  it("spawns a process and collects stdout", async () => {
    const events = [];
    for await (const event of spawnCliAgent({
      command: "echo",
      args: ["hello world"],
      cwd: "/tmp",
      timeoutMs: 5000,
      maxOutputBytes: 10_000,
      gracefulShutdownMs: 1000,
    })) {
      events.push(event);
    }

    expect(events[0].type).toBe("invocation_started");
    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    expect((responseEnd as { content: string }).content.trim()).toBe("hello world");
  });

  it("emits error for non-zero exit code", async () => {
    const events = [];
    for await (const event of spawnCliAgent({
      command: "false",
      args: [],
      cwd: "/tmp",
      timeoutMs: 5000,
      maxOutputBytes: 10_000,
      gracefulShutdownMs: 1000,
    })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  it("emits timeout when process takes too long", async () => {
    const events = [];
    for await (const event of spawnCliAgent({
      command: "sleep",
      args: ["10"],
      cwd: "/tmp",
      timeoutMs: 500,
      maxOutputBytes: 10_000,
      gracefulShutdownMs: 200,
    })) {
      events.push(event);
    }

    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/adapters/src/__tests__/cli-agent.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CLI agent spawner**

`packages/adapters/src/cli-agent.ts`:

```ts
import { spawn } from "node:child_process";
import type { AgentEvent } from "@roundtable/core";

export type SpawnOptions = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  gracefulShutdownMs: number;
  signal?: AbortSignal;
};

export async function* spawnCliAgent(options: SpawnOptions): AsyncGenerator<AgentEvent> {
  const { command, args, cwd, timeoutMs, maxOutputBytes, gracefulShutdownMs, signal } = options;

  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  const pid = child.pid ?? 0;
  yield {
    type: "invocation_started",
    command,
    pid,
    timestamp: new Date().toISOString(),
  };

  yield {
    type: "invocation_metadata",
    cwd,
    command,
    args,
    envKeys: Object.keys(process.env).filter((k) => !k.startsWith("npm_")),
  };

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  let truncated = false;

  const stdoutChunks: AgentEvent[] = [];

  child.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    if (!truncated && stdoutBytes + data.length <= maxOutputBytes) {
      stdout += text;
      stdoutBytes += data.length;
      stdoutChunks.push({ type: "chunk", content: text, stream: "stdout" });
    } else if (!truncated) {
      truncated = true;
      stdoutChunks.push({
        type: "output_truncated",
        stream: "stdout",
        originalBytes: stdoutBytes + data.length,
        keptBytes: stdoutBytes,
      });
    }
  });

  child.stderr?.on("data", (data: Buffer) => {
    stderr += data.toString();
    stdoutChunks.push({ type: "chunk", content: data.toString(), stream: "stderr" });
  });

  // Timeout handling
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) child.kill("SIGKILL");
    }, gracefulShutdownMs);
  }, timeoutMs);

  // Abort signal handling
  if (signal) {
    signal.addEventListener("abort", () => {
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, gracefulShutdownMs);
    });
  }

  // Wait for process to exit
  const exitCode = await new Promise<number>((resolve) => {
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(1);
    });
  });

  // Yield all collected chunks
  for (const chunk of stdoutChunks) {
    yield chunk;
  }

  const durationMs = Date.now() - startTime;

  if (killed) {
    yield { type: "timeout", durationMs, killed: true };
    return;
  }

  if (exitCode !== 0) {
    yield { type: "error", error: `Process exited with code ${exitCode}`, stderr, exitCode };
    return;
  }

  yield { type: "response_end", content: stdout, durationMs, exitCode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/adapters/src/__tests__/cli-agent.test.ts`
Expected: all 3 tests PASS

- [ ] **Step 5: Update index.ts**

Add to `packages/adapters/src/index.ts`:

```ts
export { spawnCliAgent } from "./cli-agent.js";
```

- [ ] **Step 6: Commit**

```bash
git add packages/adapters/
git commit -m "feat(adapters): add base CLI agent process spawner with timeout and truncation"
```

---

### Task 27: Claude and Codex Adapters

**Files:**

- Create: `packages/adapters/src/claude.ts`
- Create: `packages/adapters/src/codex.ts`
- Create: `packages/adapters/src/steward-claude.ts`

These adapters wrap `spawnCliAgent` with provider-specific invocation details. The exact CLI flags will be pinned during testing against installed CLIs. The initial implementation uses `--print` for Claude and equivalent for Codex.

- [ ] **Step 1: Implement ClaudeAdapter**

`packages/adapters/src/claude.ts`:

```ts
import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { spawnCliAgent } from "./cli-agent.js";
import { mkdir } from "node:fs/promises";
import { tmpDir } from "@roundtable/persistence";

export class ClaudeAdapter implements AgentAdapter {
  id = "claude";
  private config: AdapterConfig;
  private dataDir: string;

  constructor(config: AdapterConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const cwd = tmpDir(this.dataDir, input.invocationId);
    await mkdir(cwd, { recursive: true });

    const contextMd = renderContextPackMarkdown(input.contextPack);
    const transcriptText = input.transcript
      .map((t) => `${t.participant}: ${t.content}`)
      .join("\n\n");

    const prompt = [
      input.systemPrompt,
      "---",
      contextMd,
      "---",
      "Transcript:",
      transcriptText,
    ].join("\n\n");

    yield* spawnCliAgent({
      command: this.config.command,
      args: ["--print", prompt],
      cwd,
      timeoutMs: this.config.limits.invocationTimeoutMs,
      maxOutputBytes: this.config.limits.maxOutputBytes,
      gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
      signal,
    });
  }
}
```

- [ ] **Step 2: Implement CodexAdapter**

`packages/adapters/src/codex.ts`:

```ts
import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { spawnCliAgent } from "./cli-agent.js";
import { mkdir } from "node:fs/promises";
import { tmpDir } from "@roundtable/persistence";

export class CodexAdapter implements AgentAdapter {
  id = "codex";
  private config: AdapterConfig;
  private dataDir: string;

  constructor(config: AdapterConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const cwd = tmpDir(this.dataDir, input.invocationId);
    await mkdir(cwd, { recursive: true });

    const contextMd = renderContextPackMarkdown(input.contextPack);
    const transcriptText = input.transcript
      .map((t) => `${t.participant}: ${t.content}`)
      .join("\n\n");

    const prompt = [
      input.systemPrompt,
      "---",
      contextMd,
      "---",
      "Transcript:",
      transcriptText,
    ].join("\n\n");

    // Codex CLI invocation — flags are provisional, must be verified against installed CLI
    // TODO: pin exact flags during Milestone 6 integration testing
    yield* spawnCliAgent({
      command: this.config.command,
      args: ["-q", prompt],
      cwd,
      timeoutMs: this.config.limits.invocationTimeoutMs,
      maxOutputBytes: this.config.limits.maxOutputBytes,
      gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
      signal,
    });
  }
}
```

- [ ] **Step 3: Implement StewardAdapter**

`packages/adapters/src/steward-claude.ts`:

```ts
import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { spawnCliAgent } from "./cli-agent.js";
import { mkdir } from "node:fs/promises";
import { tmpDir } from "@roundtable/persistence";

export class StewardAdapter implements AgentAdapter {
  id = "steward";
  private config: AdapterConfig;
  private dataDir: string;

  constructor(config: AdapterConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const cwd = tmpDir(this.dataDir, input.invocationId);
    await mkdir(cwd, { recursive: true });

    const contextMd = renderContextPackMarkdown(input.contextPack);
    const transcriptText = input.transcript
      .map((t) => `${t.participant}: ${t.content}`)
      .join("\n\n");

    const prompt = [
      input.systemPrompt,
      "---",
      contextMd,
      "---",
      "Transcript:",
      transcriptText,
      "---",
      "Respond ONLY with the JSON decision object.",
    ].join("\n\n");

    yield* spawnCliAgent({
      command: this.config.command,
      args: ["--print", prompt],
      cwd,
      timeoutMs: this.config.limits.invocationTimeoutMs,
      maxOutputBytes: this.config.limits.maxOutputBytes,
      gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
      signal,
    });
  }
}
```

- [ ] **Step 4: Update adapters index.ts**

```ts
export { MockAdapter } from "./mock.js";
export type { MockAdapterConfig } from "./mock.js";
export { spawnCliAgent } from "./cli-agent.js";
export { ClaudeAdapter } from "./claude.js";
export { CodexAdapter } from "./codex.js";
export { StewardAdapter } from "./steward-claude.js";
```

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/
git commit -m "feat(adapters): add Claude, Codex, and Steward real CLI adapters"
```

---

### Task 28: CLI Detection and Error Messages

**Files:**

- Modify: `apps/cli/src/commands/convene.ts`

- [ ] **Step 1: Add CLI detection utility**

Add to the convene command, before adapter creation when not using `--mock`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

async function detectCli(command: string, name: string): Promise<void> {
  try {
    await execFileAsync(command, ["--version"]);
  } catch {
    console.error(`Error: ${name} CLI not found.`);
    console.error(`Make sure '${command}' is installed and available in your PATH.`);
    console.error(`You can configure a custom path in roundtable.config.yaml:`);
    console.error(`  adapters:`);
    console.error(`    ${name.toLowerCase()}:`);
    console.error(`      command: /path/to/${command}`);
    process.exit(1);
  }
}
```

- [ ] **Step 2: Wire detection into convene for real adapters**

Update the adapter creation section in convene to detect CLIs before creating real adapters:

```ts
// In the non-mock branch:
await detectCli(config.adapters.claude.command, "Claude");
await detectCli(config.adapters.codex.command, "Codex");

const adapters = {
  claude: new ClaudeAdapter(config.adapters.claude, config.dataDir),
  codex: new CodexAdapter(config.adapters.codex, config.dataDir),
  steward: new StewardAdapter(config.adapters.steward, config.dataDir),
};
```

- [ ] **Step 3: Test error message**

Run: `node --import tsx apps/cli/src/index.ts convene . "test" --once`
Expected: if `claude` CLI is not installed, prints actionable error message

- [ ] **Step 4: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): add CLI detection with actionable install error messages"
```

---

### Task 29: Config Init Command

**Files:**

- Modify: `apps/cli/src/commands/config.ts`

- [ ] **Step 1: Implement config init**

Update `apps/cli/src/commands/config.ts`:

```ts
import { Command } from "commander";
import { resolveConfig } from "@roundtable/config";
import { writeFile, stat } from "node:fs/promises";

export const configCommand = new Command("config").description("Manage configuration");

configCommand
  .command("show")
  .description("Show resolved configuration")
  .action(async () => {
    const config = resolveConfig({ env: process.env as Record<string, string> });
    console.log(JSON.stringify(config, null, 2));
  });

configCommand
  .command("init")
  .description("Generate a roundtable.config.yaml template")
  .action(async () => {
    const filename = "roundtable.config.yaml";
    try {
      await stat(filename);
      console.error(`Error: ${filename} already exists.`);
      process.exit(1);
    } catch {
      // File doesn't exist, good
    }

    const template = `# Roundtable Configuration
# See: docs/superpowers/specs/2026-05-06-roundtable-v1-design.md

context:
  budgetBytes: 100000
  maxFiles: 50
  maxFileBytes: 10000
  maxTreeDepth: 5
  # includes:
  #   - "src/**/*.ts"
  # excludes:
  #   - "**/*.test.ts"

deliberation:
  maxRounds: 2
  participantTimeoutMs: 120000
  deliberationTimeoutMs: 600000

adapters:
  claude:
    command: claude
  codex:
    command: codex
  steward:
    command: claude
`;

    await writeFile(filename, template, "utf-8");
    console.log(`Created ${filename}`);
  });
```

- [ ] **Step 2: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): implement config show and config init commands"
```

---

### Task 30: Full Test Suite Pass

**Files:** No new files — verification task.

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: all packages compile with no errors

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: all tests pass

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: no errors

- [ ] **Step 4: Run format check**

Run: `pnpm format:check`
Expected: all files formatted correctly (run `pnpm format` first if needed)

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: fix lint/format issues across all packages"
```

---

## Summary

This plan implements the complete Roundtable v1 across 30 tasks in 5 phases:

| Phase          | Tasks | What it delivers                              |
| -------------- | ----- | --------------------------------------------- |
| 1. Foundation  | 1-8   | Buildable monorepo, types, schemas, config    |
| 2. Data Layer  | 9-16  | Persistence, context pack builder, redaction  |
| 3. Engine      | 17-20 | Mock adapters, turn loop, engine orchestrator |
| 4. CLI         | 21-25 | Interactive terminal app, acceptance test     |
| 5. Integration | 26-30 | Real CLI adapters, polish, full verification  |

**Key principle:** The product loop is proven with mock adapters (Phase 3-4) before real Claude/Codex integration (Phase 5). This isolates process-adapter complexity from product-loop bugs.

**Self-review notes (resolved):**

- Git summary populated in context pack builder via `gatherGitSummary()`
- Lifecycle events emitted: `session_started`, `session_archived`, `context_pack_built`
- `refreshContext()` method added to `RoundtableEngine`
- `/refresh-context` and `/transcript` slash commands implemented (not stubs)
- Transcript budget enforcement added to `buildTranscript()`
- `ResolvedConfig` type alias defined for clarity
- `SessionMetaSchema.configSnapshot` uses generic record at storage boundary (core doesn't depend on config package)
- Codex CLI flags marked as provisional — must be pinned during integration testing

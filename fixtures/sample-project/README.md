# Sample Project

A minimal project for manual smoke testing of `roundtable convene`.

## Smoke Tests (from repo root)

**Mock mode (no auth required):**

```bash
pnpm build
pnpm roundtable convene ./fixtures/sample-project "What should I work on?" --once --mock
```

**Dry run (no auth, no session created):**

```bash
pnpm roundtable convene ./fixtures/sample-project --dry-run
```

**Real mode (requires Claude + Codex CLI auth):**

```bash
pnpm roundtable convene ./fixtures/sample-project "What should I work on?" --once
```

Real mode requires:

- `claude` CLI installed and authenticated (`claude auth`)
- `codex` CLI installed and authenticated (`codex login`)
- If either CLI is missing, an actionable error is shown with install instructions

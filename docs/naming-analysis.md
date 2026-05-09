# Naming Analysis: Roundtable Replacement

**Date:** 2026-05-08
**Status:** Proposal — no rename until explicitly approved

---

## Problem

"Roundtable" collides with roundtable.now (multi-model AI councils with a "Council Moderator" for consensus/synthesis) and several other "AI Roundtable" projects. Our project occupies the same conceptual space — multi-agent deliberation with a moderator — making the name confusing for anyone who encounters both.

## What makes our project distinct

- **CLI-first** — not a web SaaS
- **Local folder as input** — reads a user-selected directory, builds a curated context pack
- **CLI child processes** — invokes Claude/Codex via their local CLIs, not API SDKs
- **Event-sourced persistence** — JSONL append-only log, artifact-backed sessions
- **Read-only by design** — deliberation doesn't mutate the target project
- **Developer tooling** — intended to integrate with kctl, Service Hub, vault, local dev loops
- **Steward as moderator** — advisory only, app owns the turn loop

The name should signal "developer deliberation room" not "hosted AI brainstorm platform."

---

## Naming Criteria

1. **Ownable** — no existing product with the same name in the AI/dev-tools space
2. **Evocative** — fits the knight/council/steward/deliberation theme already in the code
3. **CLI-friendly** — short, typeable, no hyphens in the binary name
4. **Extensible** — works as a package scope (`@name/core`), config file (`name.config.yaml`), env var (`NAME_HOME`)
5. **Distinctive** — doesn't generically describe what every AI multi-agent tool does

---

## Candidate Names

### 1. Wardroom

The room on a ship where officers meet to deliberate. Directly maps to "a room where qualified agents convene to discuss a topic."

| Aspect    | Assessment                                                             |
| --------- | ---------------------------------------------------------------------- |
| Ownable   | Strong — no AI/dev-tools product uses this name                        |
| Theme fit | Excellent — officers deliberating in a private room, advisory capacity |
| CLI       | `wardroom convene ./my-project "question"` — natural                   |
| Scope     | `@wardroom/core` — clean                                               |
| Config    | `wardroom.config.yaml`, `WARDROOM_HOME` — good                         |
| Risk      | Nautical rather than medieval/knight — slight theme drift from Steward |

### 2. Council Chamber

The physical room where a council meets. Captures the deliberation-room concept directly.

| Aspect    | Assessment                                                         |
| --------- | ------------------------------------------------------------------ |
| Ownable   | Moderate — generic phrase, but no AI product uses it               |
| Theme fit | Strong — medieval council theme, matches Steward                   |
| CLI       | `council-chamber` or `chamber` — two words is awkward for a binary |
| Scope     | `@council-chamber/core` — long                                     |
| Config    | `council-chamber.config.yaml` — verbose                            |
| Risk      | Two words; users will abbreviate to `chamber` informally           |

### 3. Tablekeep

The one who keeps the table — maintains the deliberation space. Invented compound, highly ownable.

| Aspect    | Assessment                                                  |
| --------- | ----------------------------------------------------------- |
| Ownable   | Very strong — no existing product                           |
| Theme fit | Strong — "keeping the table" where deliberation happens     |
| CLI       | `tablekeep convene ./project` — good, one word              |
| Scope     | `@tablekeep/core` — clean                                   |
| Config    | `tablekeep.config.yaml`, `TABLEKEEP_HOME` — natural         |
| Risk      | Invented word — requires a beat to parse on first encounter |

### 4. Steward

Already the name of the moderator role in our system. Promotes it to the product name.

| Aspect    | Assessment                                                                              |
| --------- | --------------------------------------------------------------------------------------- |
| Ownable   | Weak — very common English word, many products named Steward                            |
| Theme fit | Perfect thematic fit                                                                    |
| CLI       | `steward convene` — natural                                                             |
| Scope     | `@steward/core` — likely taken on npm                                                   |
| Config    | `steward.config.yaml` — collision risk with other tools                                 |
| Risk      | npm scope probably unavailable; confuses the role name with the product name internally |

### 5. Keep Council

"Keep" as in a fortified tower + "council" as in deliberation body.

| Aspect    | Assessment                                                      |
| --------- | --------------------------------------------------------------- |
| Ownable   | Strong — no AI product uses this                                |
| Theme fit | Excellent — medieval fortress + advisory council                |
| CLI       | `keep-council` or `kcouncil` — two words is awkward             |
| Scope     | `@keep-council/core` — long                                     |
| Config    | `keep-council.config.yaml` — verbose                            |
| Risk      | Two-word compound; same CLI ergonomics issue as Council Chamber |

### 6. Oathroom

The room where oaths (commitments, decisions) are made. Invented compound.

| Aspect    | Assessment                                                                     |
| --------- | ------------------------------------------------------------------------------ |
| Ownable   | Very strong — no existing product                                              |
| Theme fit | Strong — solemn deliberation space, decisions carry weight                     |
| CLI       | `oathroom convene ./project` — one word, typeable                              |
| Scope     | `@oathroom/core` — clean                                                       |
| Config    | `oathroom.config.yaml`, `OATHROOM_HOME` — works                                |
| Risk      | Slightly dramatic; "oath" implies binding commitment, but our tool is advisory |

### 7. Code Council

Descriptive: a council about code.

| Aspect    | Assessment                                  |
| --------- | ------------------------------------------- |
| Ownable   | Weak — extremely generic, likely collisions |
| Theme fit | Functional but bland                        |
| CLI       | `code-council` — two words                  |
| Scope     | `@code-council/core` — generic              |
| Config    | `code-council.config.yaml` — verbose        |
| Risk      | SEO nightmare; impossible to own as a brand |

### 8. Local Council

Descriptive: a local council.

| Aspect    | Assessment                                               |
| --------- | -------------------------------------------------------- |
| Ownable   | Weak — common phrase (local government councils)         |
| Theme fit | Captures "local-first" but not the deliberation theme    |
| CLI       | `local-council` — two words, collides with civic meaning |
| Scope     | `@local-council/core` — confusing                        |
| Config    | Reads like a government config file                      |
| Risk      | Strong association with local government; misleading     |

### 9. Council Runtime

Technical/descriptive hybrid.

| Aspect    | Assessment                                               |
| --------- | -------------------------------------------------------- |
| Ownable   | Moderate — no direct collision                           |
| Theme fit | Weak — "runtime" is infrastructure jargon, not evocative |
| CLI       | `council-runtime` — too long for a binary                |
| Scope     | `@council-runtime/core` — very long                      |
| Config    | `council-runtime.config.yaml` — unwieldy                 |
| Risk      | Sounds like infrastructure, not a developer tool         |

### 10. Convoke

To call together for a meeting. The verb form of "convocation."

| Aspect    | Assessment                                            |
| --------- | ----------------------------------------------------- |
| Ownable   | Strong — no AI/dev-tools product uses this            |
| Theme fit | Excellent — the act of summoning agents to deliberate |
| CLI       | `convoke ./my-project "question"` — short, direct     |
| Scope     | `@convoke/core` — clean                               |
| Config    | `convoke.config.yaml`, `CONVOKE_HOME` — natural       |
| Risk      | Slightly academic; some users may not know the word   |

### 11. Dais

The raised platform from which a council addresses the room.

| Aspect    | Assessment                                                                    |
| --------- | ----------------------------------------------------------------------------- |
| Ownable   | Strong — short, distinctive, no AI product uses it                            |
| Theme fit | Good — the elevated platform for deliberation, authority                      |
| CLI       | `dais convene ./project` — very short                                         |
| Scope     | `@dais/core` — extremely clean                                                |
| Config    | `dais.config.yaml`, `DAIS_HOME` — minimal                                     |
| Risk      | Obscure word; most developers won't know it. Possibly too short to search for |

### 12. Wardtable

Combines "ward" (to guard/protect) with "table" (where council sits). Invented compound.

| Aspect    | Assessment                                                                              |
| --------- | --------------------------------------------------------------------------------------- |
| Ownable   | Very strong — no existing product                                                       |
| Theme fit | Strong — guarded deliberation table, read-only ethos                                    |
| CLI       | `wardtable convene ./project` — one word, clear                                         |
| Scope     | `@wardtable/core` — clean                                                               |
| Config    | `wardtable.config.yaml`, `WARDTABLE_HOME` — natural                                     |
| Risk      | Similar to "roundtable" in structure, which could be good (familiar) or bad (confusion) |

---

## Top 3 Recommendations

### 1. Wardroom (recommended)

Best overall balance. Ownable, one word, naturally maps to the concept (officers deliberating in a private room), CLI-ergonomic, clean package scope. The nautical flavor is a slight departure from the medieval/knight theme, but "wardroom" has the right connotation: a closed room where qualified people discuss a matter, with the ship's captain (user) making final decisions. The Steward role still fits — ships have stewards.

### 2. Convoke

Strong verb-as-product-name. "To convoke" means to summon for deliberation, which is exactly what the tool does. `convoke ./my-project "question"` reads like natural language. The existing `convene` subcommand maps perfectly — or could be dropped entirely since the product name already implies the action. Slightly academic but memorable.

### 3. Tablekeep

Most ownable of all candidates. Invented compound that immediately suggests "the thing that maintains the deliberation table." One word, good CLI ergonomics, clean scope. The tradeoff is that it's an invented word requiring a moment to parse, but it's self-explanatory once understood.

### Why not the others

- **Steward** — too common, npm scope likely taken, confuses the internal role name with the product
- **Council Chamber / Keep Council / Code Council / Local Council / Council Runtime** — two-word names are awkward as CLI binaries and package scopes
- **Oathroom** — too dramatic for advisory-only tooling ("oath" implies binding commitment)
- **Dais** — too obscure, too short to search for
- **Wardtable** — structural similarity to "roundtable" invites the confusion we're trying to escape

---

## Migration Plan (for Wardroom, adapt if different name chosen)

### Phase 1: Code rename (single PR)

| Surface            | Current                      | New                        |
| ------------------ | ---------------------------- | -------------------------- |
| GitHub repo        | `roundtable`                 | `wardroom`                 |
| Package scope      | `@roundtable/*`              | `@wardroom/*`              |
| CLI binary         | `roundtable`                 | `wardroom`                 |
| Config file        | `roundtable.config.yaml`     | `wardroom.config.yaml`     |
| Config dir         | `~/.config/roundtable/`      | `~/.config/wardroom/`      |
| Data dir           | `~/.local/share/roundtable/` | `~/.local/share/wardroom/` |
| Env var            | `ROUNDTABLE_HOME`            | `WARDROOM_HOME`            |
| Context file       | `ROUNDTABLE.md`              | `WARDROOM.md`              |
| Internal category  | `roundtable_config`          | `wardroom_config`          |
| System participant | `"roundtable"`               | `"wardroom"`               |
| CLAUDE.md          | References to Roundtable     | References to Wardroom     |

### Phase 2: File-by-file scope

1. **`package.json` (root + all workspaces)** — rename `name` fields, update cross-references
2. **`pnpm-workspace.yaml`** — no change needed (path-based)
3. **`tsconfig.json` references** — no change needed (path-based)
4. **`apps/cli/package.json`** — `bin.roundtable` -> `bin.wardroom`
5. **`packages/config/`** — config file names, env var names, default paths
6. **`packages/persistence/`** — default data dir path
7. **`packages/context/`** — `ROUNDTABLE.md` recognition, `roundtable_config` category
8. **`README.md`** — all references
9. **`CLAUDE.md`** — all references
10. **`docs/`** — spec and plan references
11. **Test files** — string literals, fixture files
12. **`fixtures/sample-project/ROUNDTABLE.md`** — rename to `WARDROOM.md`

### Phase 3: Backward compatibility

| Concern          | Approach                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old config files | On startup, check for `roundtable.config.yaml`; if found and no `wardroom.config.yaml` exists, print a one-time migration notice and load it. Remove in v2. |
| Old data dir     | Same pattern: check `~/.local/share/roundtable/`, print migration notice, read from it. Do not auto-rename (user's data).                                   |
| Old env var      | Check `ROUNDTABLE_HOME` if `WARDROOM_HOME` is unset; print deprecation notice.                                                                              |
| Old context file | Recognize both `ROUNDTABLE.md` and `WARDROOM.md` as `wardroom_config` category.                                                                             |
| Git tags         | Existing tags stay under their original names. Add a note in release notes: "Previously named Roundtable."                                                  |
| npm              | No published packages yet, so no registry migration needed.                                                                                                 |
| GitHub redirect  | GitHub auto-redirects old repo URLs after rename.                                                                                                           |

### Phase 4: Communication

- Release notes: "Roundtable has been renamed to Wardroom to avoid confusion with existing products in the AI council/debate space. All functionality is unchanged."
- README: Remove the naming disclaimer, add a one-line "Previously known as Roundtable" note.
- CLAUDE.md: Update project name.

### Execution

The rename is mechanical but wide — every package, every test string literal, the fixture file, the spec doc. Recommend doing it as a single atomic PR with a script-assisted find/replace, followed by `pnpm install && pnpm build && pnpm test` to verify nothing broke. The backward-compatibility shims (old config/data dir/env var fallback) can be a separate follow-up PR since no users exist yet.

---

## Decision (2026-05-08)

**Chosen name: Wardroom**

**Rename timing: Deferred.** The rename will happen as a dedicated milestone after current stabilization work is complete (context-pack selection fixes, artifact persistence, workspace dependency cycle cleanup, streaming output). The repo remains `roundtable` until then.

**Backward compatibility: Minimal.** No real external users exist yet, so heavy compat shims are unnecessary. Consider a temporary `roundtable` CLI alias for one release only if trivial. Historical tags/releases remain under the Roundtable codename. Public docs should eventually note: "Roundtable was the original codename; the project is now Wardroom."

**Current state:**

- README disclaimer is committed (notes independence from roundtable.now)
- Repo stays as `roundtable` until the rename milestone
- No code changes until rename is explicitly triggered

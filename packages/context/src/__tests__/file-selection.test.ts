import { describe, it, expect } from "vitest";
import type { ContextConfig } from "@wardroom/core";
import { categorizeFile, isHardDenied, isDefaultExcluded, selectFiles } from "../file-selection.js";
import type { ScannedFile } from "../scan-folder.js";

describe("categorizeFile", () => {
  it("categorizes WARDROOM.md as wardroom_config", () => {
    expect(categorizeFile("WARDROOM.md")).toBe("wardroom_config");
  });

  it("categorizes COUNCIL.md as wardroom_config", () => {
    expect(categorizeFile("COUNCIL.md")).toBe("wardroom_config");
  });

  it("categorizes AGENTS.md as agent_config", () => {
    expect(categorizeFile("AGENTS.md")).toBe("agent_config");
  });

  it("categorizes CLAUDE.md as agent_config", () => {
    expect(categorizeFile("CLAUDE.md")).toBe("agent_config");
  });

  it("categorizes .cursorrules as agent_config", () => {
    expect(categorizeFile(".cursorrules")).toBe("agent_config");
  });

  it("categorizes README.md as project_meta", () => {
    expect(categorizeFile("README.md")).toBe("project_meta");
  });

  it("categorizes package.json as project_meta", () => {
    expect(categorizeFile("package.json")).toBe("project_meta");
  });

  it("categorizes tsconfig.json as project_meta", () => {
    expect(categorizeFile("tsconfig.json")).toBe("project_meta");
  });

  it("categorizes Cargo.toml as project_meta", () => {
    expect(categorizeFile("Cargo.toml")).toBe("project_meta");
  });

  it("categorizes go.mod as project_meta", () => {
    expect(categorizeFile("go.mod")).toBe("project_meta");
  });

  it("categorizes pyproject.toml as project_meta", () => {
    expect(categorizeFile("pyproject.toml")).toBe("project_meta");
  });

  it("categorizes Makefile as project_meta", () => {
    expect(categorizeFile("Makefile")).toBe("project_meta");
  });

  it("categorizes pnpm-workspace.yaml as project_meta", () => {
    expect(categorizeFile("pnpm-workspace.yaml")).toBe("project_meta");
  });

  it("categorizes docker-compose.yml as config", () => {
    expect(categorizeFile("docker-compose.yml")).toBe("config");
  });

  it("categorizes docker-compose.yaml as config", () => {
    expect(categorizeFile("docker-compose.yaml")).toBe("config");
  });

  it("categorizes Dockerfile as config", () => {
    expect(categorizeFile("Dockerfile")).toBe("config");
  });

  it("categorizes .github/workflows/ci.yml as config", () => {
    expect(categorizeFile(".github/workflows/ci.yml")).toBe("config");
  });

  it("categorizes .gitlab-ci.yml as config", () => {
    expect(categorizeFile(".gitlab-ci.yml")).toBe("config");
  });

  it("categorizes docs/guide.md as documentation", () => {
    expect(categorizeFile("docs/guide.md")).toBe("documentation");
  });

  it("categorizes docs/sub/nested.md as documentation", () => {
    expect(categorizeFile("docs/sub/nested.md")).toBe("documentation");
  });

  it("categorizes src/index.ts as source", () => {
    expect(categorizeFile("src/index.ts")).toBe("source");
  });

  it("categorizes lib/utils.js as source", () => {
    expect(categorizeFile("lib/utils.js")).toBe("source");
  });

  it("categorizes fixtures/ files as other", () => {
    expect(categorizeFile("src/__tests__/fixtures/sample/data.json")).toBe("other");
  });

  it("categorizes __fixtures__/ files as other", () => {
    expect(categorizeFile("tests/__fixtures__/mock.json")).toBe("other");
  });

  it("categorizes fixture WARDROOM.md as other, not wardroom_config", () => {
    expect(categorizeFile("fixtures/sample-project/WARDROOM.md")).toBe("other");
    expect(
      categorizeFile("packages/context/src/__tests__/fixtures/sample-project/WARDROOM.md"),
    ).toBe("other");
  });

  it("categorizes fixture package.json as other, not project_meta", () => {
    expect(categorizeFile("fixtures/sample-project/package.json")).toBe("other");
  });

  it("still categorizes real WARDROOM.md as wardroom_config", () => {
    expect(categorizeFile("WARDROOM.md")).toBe("wardroom_config");
  });
});

describe("isHardDenied", () => {
  it("denies .env", () => {
    expect(isHardDenied(".env")).toBe(true);
  });

  it("denies .env.local", () => {
    expect(isHardDenied(".env.local")).toBe(true);
  });

  it("denies .env.production", () => {
    expect(isHardDenied(".env.production")).toBe(true);
  });

  it("denies server.pem", () => {
    expect(isHardDenied("certs/server.pem")).toBe(true);
  });

  it("denies private.key", () => {
    expect(isHardDenied("private.key")).toBe(true);
  });

  it("denies credentials.json", () => {
    expect(isHardDenied("credentials.json")).toBe(true);
  });

  it("denies id_rsa", () => {
    expect(isHardDenied("id_rsa")).toBe(true);
  });

  it("denies id_rsa.pub", () => {
    expect(isHardDenied("id_rsa.pub")).toBe(true);
  });

  it("denies database.sqlite", () => {
    expect(isHardDenied("data/database.sqlite")).toBe(true);
  });

  it("denies app.db", () => {
    expect(isHardDenied("app.db")).toBe(true);
  });

  it("denies data.duckdb", () => {
    expect(isHardDenied("data.duckdb")).toBe(true);
  });

  it("denies app.sqlite3", () => {
    expect(isHardDenied("app.sqlite3")).toBe(true);
  });

  it("does not deny README.md", () => {
    expect(isHardDenied("README.md")).toBe(false);
  });

  it("does not deny src/index.ts", () => {
    expect(isHardDenied("src/index.ts")).toBe(false);
  });
});

describe("isDefaultExcluded", () => {
  it("excludes node_modules files", () => {
    expect(isDefaultExcluded("node_modules/foo/index.js")).toBe(true);
  });

  it("excludes dist files", () => {
    expect(isDefaultExcluded("dist/index.js")).toBe(true);
  });

  it("excludes pnpm-lock.yaml", () => {
    expect(isDefaultExcluded("pnpm-lock.yaml")).toBe(true);
  });

  it("excludes package-lock.json", () => {
    expect(isDefaultExcluded("package-lock.json")).toBe(true);
  });

  it("excludes yarn.lock", () => {
    expect(isDefaultExcluded("yarn.lock")).toBe(true);
  });

  it("excludes .png files", () => {
    expect(isDefaultExcluded("logo.png")).toBe(true);
  });

  it("excludes .jpg files", () => {
    expect(isDefaultExcluded("photo.jpg")).toBe(true);
  });

  it("excludes .zip files", () => {
    expect(isDefaultExcluded("archive.zip")).toBe(true);
  });

  it("excludes .pdf files", () => {
    expect(isDefaultExcluded("doc.pdf")).toBe(true);
  });

  it("excludes .woff2 files", () => {
    expect(isDefaultExcluded("font.woff2")).toBe(true);
  });

  it("excludes .claude/ worktree files at root", () => {
    expect(isDefaultExcluded(".claude/worktrees/agent-a23fb415/CLAUDE.md")).toBe(true);
  });

  it("excludes .claude/ files nested in subdirectories", () => {
    expect(isDefaultExcluded("some/path/.claude/settings.json")).toBe(true);
  });

  it("excludes .worktrees/ files at root", () => {
    expect(isDefaultExcluded(".worktrees/feature-branch/src/index.ts")).toBe(true);
  });

  it("excludes .tsbuildinfo files at root", () => {
    expect(isDefaultExcluded("tsconfig.tsbuildinfo")).toBe(true);
  });

  it("excludes .tsbuildinfo files in subdirectories", () => {
    expect(isDefaultExcluded("packages/core/tsconfig.tsbuildinfo")).toBe(true);
  });

  it("excludes nested dist/ directories", () => {
    expect(isDefaultExcluded("packages/core/dist/index.js")).toBe(true);
  });

  it("excludes nested build/ directories", () => {
    expect(isDefaultExcluded("apps/cli/build/main.js")).toBe(true);
  });

  it("excludes nested .next/ directories", () => {
    expect(isDefaultExcluded("apps/web/.next/server/page.js")).toBe(true);
  });

  it("excludes nested coverage/ directories", () => {
    expect(isDefaultExcluded("packages/core/coverage/lcov.info")).toBe(true);
  });

  it("does not exclude src/index.ts", () => {
    expect(isDefaultExcluded("src/index.ts")).toBe(false);
  });

  it("does not exclude README.md", () => {
    expect(isDefaultExcluded("README.md")).toBe(false);
  });
});

describe("selectFiles", () => {
  const makeFile = (relativePath: string, bytes: number): ScannedFile => ({
    relativePath,
    absolutePath: `/project/${relativePath}`,
    bytes,
  });

  const defaultConfig: ContextConfig = {
    budgetBytes: 100_000,
    maxFiles: 50,
    maxFileBytes: 10_000,
    maxTreeDepth: 5,
  };

  it("selects files in priority order", () => {
    const scanned: ScannedFile[] = [
      makeFile("src/index.ts", 100),
      makeFile("README.md", 200),
      makeFile("WARDROOM.md", 150),
      makeFile("docs/guide.md", 300),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const paths = result.selected.map((f) => f.path);

    // WARDROOM.md (priority 1), README.md (priority 3),
    // docs/guide.md (priority 6), src/index.ts (priority 7 — peripheral barrel)
    expect(paths[0]).toBe("WARDROOM.md");
    expect(paths[1]).toBe("README.md");
    expect(paths[2]).toBe("docs/guide.md");
    expect(paths[3]).toBe("src/index.ts");
  });

  it("excludes hard-denied files with reason", () => {
    const scanned: ScannedFile[] = [
      makeFile("README.md", 100),
      makeFile(".env.local", 50),
      makeFile("certs/server.pem", 200),
    ];

    const result = selectFiles(scanned, defaultConfig);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.path).toBe("README.md");

    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain(".env.local");
    expect(omittedPaths).toContain("certs/server.pem");

    const envOmitted = result.omitted.files.find((f) => f.path === ".env.local");
    expect(envOmitted!.reason).toBe("hard_denied");
  });

  it("hard-deny overrides explicit includes", () => {
    const scanned: ScannedFile[] = [makeFile("README.md", 100), makeFile(".env.local", 50)];

    const config: ContextConfig = {
      ...defaultConfig,
      includes: [".env.local"],
    };

    const result = selectFiles(scanned, config);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.path).toBe("README.md");

    const envOmitted = result.omitted.files.find((f) => f.path === ".env.local");
    expect(envOmitted!.reason).toBe("hard_denied");
  });

  it("respects budgetBytes", () => {
    const scanned: ScannedFile[] = [
      makeFile("README.md", 500),
      makeFile("src/a.ts", 400),
      makeFile("src/b.ts", 300),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      budgetBytes: 800,
    };

    const result = selectFiles(scanned, config);
    // README.md (500) fits. src/a.ts (400): 500+400=900 > 800, skipped.
    // src/b.ts (300): 500+300=800 <= 800, fits.
    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]!.path).toBe("README.md");
    expect(result.selected[1]!.path).toBe("src/b.ts");

    const omittedReasons = result.omitted.files
      .filter((f) => f.reason === "budget_exhausted")
      .map((f) => f.path);
    expect(omittedReasons).toContain("src/a.ts");
  });

  it("respects maxFiles with max_files_exhausted reason", () => {
    const scanned: ScannedFile[] = [
      makeFile("WARDROOM.md", 10),
      makeFile("README.md", 10),
      makeFile("src/a.ts", 10),
      makeFile("src/b.ts", 10),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      maxFiles: 2,
    };

    const result = selectFiles(scanned, config);
    expect(result.selected).toHaveLength(2);
    expect(result.selected[0]!.path).toBe("WARDROOM.md");
    expect(result.selected[1]!.path).toBe("README.md");

    const omittedA = result.omitted.files.find((f) => f.path === "src/a.ts");
    expect(omittedA!.reason).toBe("max_files_exhausted");
  });

  it("excludes default-excluded files", () => {
    const scanned: ScannedFile[] = [
      makeFile("README.md", 100),
      makeFile("pnpm-lock.yaml", 50000),
      makeFile("logo.png", 2000),
    ];

    const result = selectFiles(scanned, defaultConfig);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.path).toBe("README.md");

    const lockOmitted = result.omitted.files.find((f) => f.path === "pnpm-lock.yaml");
    expect(lockOmitted!.reason).toBe("excluded_pattern");

    const pngOmitted = result.omitted.files.find((f) => f.path === "logo.png");
    expect(pngOmitted!.reason).toBe("binary_file");
  });

  it("assigns correct categories to selected files", () => {
    const scanned: ScannedFile[] = [
      makeFile("WARDROOM.md", 100),
      makeFile("README.md", 100),
      makeFile("docs/guide.md", 100),
      makeFile("src/index.ts", 100),
      makeFile("docker-compose.yml", 100),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const byPath = Object.fromEntries(result.selected.map((f) => [f.path, f]));

    expect(byPath["WARDROOM.md"]!.category).toBe("wardroom_config");
    expect(byPath["README.md"]!.category).toBe("project_meta");
    expect(byPath["docs/guide.md"]!.category).toBe("documentation");
    expect(byPath["src/index.ts"]!.category).toBe("source");
    expect(byPath["docker-compose.yml"]!.category).toBe("config");
  });

  it("excludes .claude/worktrees files from selection", () => {
    const scanned: ScannedFile[] = [
      makeFile("src/index.ts", 100),
      makeFile(".claude/worktrees/agent-a23fb415/CLAUDE.md", 200),
      makeFile(".claude/worktrees/agent-a23fb415/package.json", 300),
      makeFile(".claude/worktrees/agent-afe37e78/README.md", 150),
    ];

    const result = selectFiles(scanned, defaultConfig);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.path).toBe("src/index.ts");

    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain(".claude/worktrees/agent-a23fb415/CLAUDE.md");
    expect(omittedPaths).toContain(".claude/worktrees/agent-a23fb415/package.json");
    expect(omittedPaths).toContain(".claude/worktrees/agent-afe37e78/README.md");
  });

  it("excludes .tsbuildinfo files from selection", () => {
    const scanned: ScannedFile[] = [
      makeFile("src/index.ts", 100),
      makeFile("tsconfig.tsbuildinfo", 5000),
      makeFile("packages/core/tsconfig.tsbuildinfo", 3000),
    ];

    const result = selectFiles(scanned, defaultConfig);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]!.path).toBe("src/index.ts");
  });

  it("includes source files before fixture and worktree metadata under budget pressure", () => {
    const scanned: ScannedFile[] = [
      makeFile("packages/core/src/engine.ts", 800),
      makeFile("packages/adapters/src/claude.ts", 600),
      makeFile("src/__tests__/fixtures/sample/data.json", 500),
      makeFile(".claude/worktrees/agent-abc/package.json", 300),
      makeFile("packages/core/src/turn-loop.ts", 700),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      budgetBytes: 2500,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Source files should be included
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");

    // Worktree files should be excluded entirely
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain(".claude/worktrees/agent-abc/package.json");
  });

  it("ranks fixture files below primary source files", () => {
    const scanned: ScannedFile[] = [
      makeFile("src/__tests__/fixtures/sample/data.json", 100),
      makeFile("packages/core/src/engine.ts", 100),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const paths = result.selected.map((f) => f.path);

    // Implementation source (priority 5) before fixtures (priority 11)
    expect(paths[0]).toBe("packages/core/src/engine.ts");
    expect(paths[1]).toBe("src/__tests__/fixtures/sample/data.json");
  });

  it("selects production source before docs/superpowers under budget pressure", () => {
    const scanned: ScannedFile[] = [
      makeFile("docs/superpowers/specs/2026-05-06-design.md", 38000),
      makeFile("packages/core/src/engine.ts", 5000),
      makeFile("packages/core/src/turn-loop.ts", 4000),
      makeFile("packages/adapters/src/claude.ts", 6000),
      makeFile("packages/adapters/src/codex.ts", 5000),
      makeFile("packages/context/src/build-context-pack.ts", 4000),
      makeFile("packages/context/src/file-selection.ts", 5000),
      makeFile("apps/cli/src/render.ts", 3000),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      budgetBytes: 40000,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // All production source files should be included
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");
    expect(selectedPaths).toContain("packages/adapters/src/codex.ts");
    expect(selectedPaths).toContain("packages/context/src/build-context-pack.ts");
    expect(selectedPaths).toContain("packages/context/src/file-selection.ts");
    expect(selectedPaths).toContain("apps/cli/src/render.ts");

    // Historical spec should be omitted due to budget
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("docs/superpowers/specs/2026-05-06-design.md");
  });

  it("docs/ files do not push core implementation files out of default budget", () => {
    // Regression: docs/naming-analysis.md (17818 bytes) was included at priority 5,
    // consuming budget before implementation source (priority 6), causing
    // turn-loop.ts, types.ts, session-store.ts, paths.ts to be budget_exhausted.
    const scanned: ScannedFile[] = [
      // Large decision/history doc
      makeFile("docs/naming-analysis.md", 17818),
      makeFile("docs/architecture.md", 8000),
      // Core implementation files that must survive budget pressure
      makeFile("packages/core/src/turn-loop.ts", 2800),
      makeFile("packages/core/src/types.ts", 5000),
      makeFile("packages/persistence/src/session-store.ts", 3500),
      makeFile("packages/persistence/src/paths.ts", 1500),
      // Other implementation files
      makeFile("packages/core/src/engine.ts", 3500),
      makeFile("packages/adapters/src/claude.ts", 3456),
      makeFile("packages/adapters/src/codex.ts", 3382),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      // Budget large enough for all impl source but not impl + all docs
      budgetBytes: 30000,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // All core implementation files must be included
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");
    expect(selectedPaths).toContain("packages/core/src/types.ts");
    expect(selectedPaths).toContain("packages/persistence/src/session-store.ts");
    expect(selectedPaths).toContain("packages/persistence/src/paths.ts");
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");
    expect(selectedPaths).toContain("packages/adapters/src/codex.ts");

    // Impl source (priority 5) should appear before docs (priority 6)
    const turnLoopIdx = selectedPaths.indexOf("packages/core/src/turn-loop.ts");
    const docsIdx = selectedPaths.indexOf("docs/naming-analysis.md");
    if (docsIdx >= 0) {
      expect(turnLoopIdx).toBeLessThan(docsIdx);
    }

    // The large doc should be pushed out or at least ranked after all impl source
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("docs/naming-analysis.md");
  });

  it("selects production source before test files under budget pressure", () => {
    const scanned: ScannedFile[] = [
      makeFile("packages/core/src/__tests__/engine.test.ts", 3000),
      makeFile("packages/core/src/engine.ts", 5000),
      makeFile("packages/adapters/src/claude.ts", 4000),
      makeFile("packages/adapters/src/__tests__/claude.test.ts", 6000),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      budgetBytes: 10000,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Production source (priority 5) selected before tests (priority 9)
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");

    // Tests should be omitted due to budget
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("packages/core/src/__tests__/engine.test.ts");
    expect(omittedPaths).toContain("packages/adapters/src/__tests__/claude.test.ts");
  });

  it("ranks core source before historical docs and tests", () => {
    const scanned: ScannedFile[] = [
      makeFile("docs/superpowers/specs/design.md", 100),
      makeFile("packages/core/src/__tests__/engine.test.ts", 100),
      makeFile("packages/core/src/engine.ts", 100),
      makeFile("packages/adapters/src/claude.ts", 100),
      makeFile("docs/guide.md", 100),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const paths = result.selected.map((f) => f.path);

    // impl source (5) → docs/guide.md (6) → tests (9) → docs/superpowers (10)
    expect(paths.indexOf("packages/core/src/engine.ts")).toBeLessThan(
      paths.indexOf("docs/guide.md"),
    );
    expect(paths.indexOf("docs/guide.md")).toBeLessThan(
      paths.indexOf("packages/core/src/__tests__/engine.test.ts"),
    );
    expect(paths.indexOf("packages/core/src/__tests__/engine.test.ts")).toBeLessThan(
      paths.indexOf("docs/superpowers/specs/design.md"),
    );
  });

  it("ranks .spec.ts files as test priority", () => {
    const scanned: ScannedFile[] = [
      makeFile("src/utils.spec.ts", 100),
      makeFile("src/utils.ts", 100),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const paths = result.selected.map((f) => f.path);

    expect(paths[0]).toBe("src/utils.ts");
    expect(paths[1]).toBe("src/utils.spec.ts");
  });

  it("selects core source before package-level metadata under file-count pressure", () => {
    const scanned: ScannedFile[] = [
      makeFile("README.md", 100),
      makeFile("package.json", 100),
      makeFile("packages/core/package.json", 100),
      makeFile("packages/core/tsconfig.json", 100),
      makeFile("packages/adapters/package.json", 100),
      makeFile("packages/adapters/tsconfig.json", 100),
      makeFile("packages/core/src/engine.ts", 100),
      makeFile("packages/core/src/turn-loop.ts", 100),
      makeFile("packages/adapters/src/claude.ts", 100),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      maxFiles: 5,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Root meta (priority 3) and impl source (priority 6) should beat
    // package-level meta (priority 8)
    expect(selectedPaths).toContain("README.md");
    expect(selectedPaths).toContain("package.json");
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");

    // Package-level metadata should be omitted
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("packages/core/package.json");
    expect(omittedPaths).toContain("packages/core/tsconfig.json");
  });

  it("fixture metadata does not consume file slots before primary source", () => {
    const scanned: ScannedFile[] = [
      makeFile("fixtures/sample-project/package.json", 100),
      makeFile("fixtures/sample-project/README.md", 100),
      makeFile("packages/core/src/engine.ts", 100),
      makeFile("packages/adapters/src/claude.ts", 100),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      maxFiles: 2,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Impl source (priority 5) before fixture files (priority 11)
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");
  });

  it("includes essential Wardroom implementation files in representative monorepo", () => {
    // Simulate the actual wardroom monorepo file layout
    const scanned: ScannedFile[] = [
      // Root meta (priority 3)
      makeFile("WARDROOM.md", 160),
      makeFile("CLAUDE.md", 1340),
      makeFile("README.md", 8626),
      makeFile("package.json", 687),
      makeFile("pnpm-workspace.yaml", 40),
      makeFile("tsconfig.json", 249),
      // Config
      makeFile(".github/workflows/ci.yml", 517),
      // Implementation source (priority 6) — the critical files
      makeFile("apps/cli/src/commands/convene.ts", 10936),
      makeFile("apps/cli/src/render.ts", 3304),
      makeFile("apps/cli/src/interactive.ts", 4297),
      makeFile("packages/core/src/engine.ts", 3500),
      makeFile("packages/core/src/turn-loop.ts", 2800),
      makeFile("packages/core/src/types.ts", 5000),
      makeFile("packages/adapters/src/claude.ts", 3456),
      makeFile("packages/adapters/src/codex.ts", 3382),
      makeFile("packages/adapters/src/cli-agent.ts", 7053),
      makeFile("packages/context/src/build-context-pack.ts", 5164),
      makeFile("packages/context/src/file-selection.ts", 7329),
      makeFile("packages/persistence/src/session-store.ts", 3500),
      // Peripheral source (priority 7) — barrels and root configs
      makeFile("apps/cli/src/index.ts", 606),
      makeFile("packages/core/src/index.ts", 314),
      makeFile("eslint.config.js", 272),
      makeFile("vitest.config.ts", 138),
      // Package-level meta (priority 8)
      makeFile("packages/core/package.json", 468),
      makeFile("packages/core/tsconfig.json", 169),
      makeFile("packages/adapters/package.json", 437),
      makeFile("packages/adapters/tsconfig.json", 234),
      makeFile("packages/context/package.json", 376),
      makeFile("packages/context/tsconfig.json", 219),
      makeFile("packages/persistence/package.json", 352),
      makeFile("packages/persistence/tsconfig.json", 178),
      makeFile("apps/cli/package.json", 522),
      makeFile("apps/cli/tsconfig.json", 402),
      // Tests (priority 9)
      makeFile("packages/core/src/__tests__/engine.test.ts", 3500),
      makeFile("packages/adapters/src/__tests__/claude.test.ts", 6000),
      // Historical docs (priority 10)
      makeFile("docs/superpowers/specs/2026-05-06-design.md", 38292),
      // Fixtures (priority 11)
      makeFile("fixtures/sample-project/README.md", 752),
      makeFile("fixtures/sample-project/package.json", 116),
    ];

    const config: ContextConfig = {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 5,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // All essential implementation files must be included
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");
    expect(selectedPaths).toContain("packages/core/src/types.ts");
    expect(selectedPaths).toContain("packages/adapters/src/claude.ts");
    expect(selectedPaths).toContain("packages/adapters/src/codex.ts");
    expect(selectedPaths).toContain("packages/adapters/src/cli-agent.ts");
    expect(selectedPaths).toContain("packages/context/src/build-context-pack.ts");
    expect(selectedPaths).toContain("packages/context/src/file-selection.ts");
    expect(selectedPaths).toContain("packages/persistence/src/session-store.ts");
    expect(selectedPaths).toContain("apps/cli/src/commands/convene.ts");
    expect(selectedPaths).toContain("apps/cli/src/render.ts");
    expect(selectedPaths).toContain("apps/cli/src/interactive.ts");

    // Implementation source should appear before package-level metadata
    const engineIdx = selectedPaths.indexOf("packages/core/src/engine.ts");
    const pkgJsonIdx = selectedPaths.indexOf("packages/core/package.json");
    expect(engineIdx).toBeLessThan(pkgJsonIdx);
  });

  it("implementation source outranks barrel index files and root configs", () => {
    const scanned: ScannedFile[] = [
      makeFile("packages/core/src/index.ts", 300),
      makeFile("eslint.config.js", 200),
      makeFile(".prettierrc", 100),
      makeFile("vitest.config.ts", 150),
      makeFile("packages/core/src/engine.ts", 5000),
      makeFile("packages/core/src/turn-loop.ts", 4000),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      // Budget fits impl source (5000+4000=9000) but not peripherals
      budgetBytes: 9000,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Implementation files (priority 5) included first
    expect(selectedPaths).toContain("packages/core/src/engine.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");

    // Peripheral source (index barrel, root configs) omitted due to budget
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("packages/core/src/index.ts");
    expect(omittedPaths).toContain("eslint.config.js");
  });

  it("implementation source outranks package metadata under budget pressure", () => {
    const scanned: ScannedFile[] = [
      makeFile("packages/core/src/types.ts", 5000),
      makeFile("packages/core/src/turn-loop.ts", 4000),
      makeFile("packages/persistence/src/session-store.ts", 3000),
      makeFile("packages/persistence/src/paths.ts", 1500),
      makeFile("packages/core/package.json", 400),
      makeFile("packages/core/tsconfig.json", 200),
      makeFile("packages/persistence/package.json", 350),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      // Budget fits impl source (5000+4000+3000+1500=13500) but not pkg meta
      budgetBytes: 13500,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // All implementation source included
    expect(selectedPaths).toContain("packages/core/src/types.ts");
    expect(selectedPaths).toContain("packages/core/src/turn-loop.ts");
    expect(selectedPaths).toContain("packages/persistence/src/session-store.ts");
    expect(selectedPaths).toContain("packages/persistence/src/paths.ts");

    // Package metadata omitted — all three exceed remaining budget
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("packages/core/package.json");
    expect(omittedPaths).toContain("packages/persistence/package.json");
  });

  it("works generically for any monorepo with src/ convention", () => {
    // Non-wardroom monorepo layout
    const scanned: ScannedFile[] = [
      makeFile("README.md", 500),
      makeFile("packages/api/src/router.ts", 3000),
      makeFile("packages/api/src/handlers.ts", 4000),
      makeFile("packages/api/src/index.ts", 200),
      makeFile("packages/db/src/schema.ts", 2000),
      makeFile("packages/db/src/migrations.ts", 3000),
      makeFile("packages/db/src/index.ts", 150),
      makeFile("packages/db/package.json", 300),
      makeFile("packages/api/package.json", 300),
      makeFile(".prettierrc", 100),
      makeFile("packages/api/src/__tests__/router.test.ts", 2000),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      budgetBytes: 14000,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Implementation source outranks peripheral and metadata
    expect(selectedPaths).toContain("packages/api/src/router.ts");
    expect(selectedPaths).toContain("packages/api/src/handlers.ts");
    expect(selectedPaths).toContain("packages/db/src/schema.ts");
    expect(selectedPaths).toContain("packages/db/src/migrations.ts");

    // Barrel indexes and root configs are lower priority
    const routerIdx = selectedPaths.indexOf("packages/api/src/router.ts");
    const barrelIdx = selectedPaths.indexOf("packages/api/src/index.ts");
    if (barrelIdx >= 0) {
      expect(routerIdx).toBeLessThan(barrelIdx);
    }
  });

  it("omitted reason distinguishes max_files_exhausted from budget_exhausted", () => {
    const scanned: ScannedFile[] = [
      makeFile("packages/a/src/foo.ts", 10),
      makeFile("packages/b/src/bar.ts", 10),
      makeFile("packages/c/src/baz.ts", 10),
      makeFile("packages/d/src/big.ts", 50000),
    ];

    // maxFiles will be hit before budgetBytes
    const configFiles: ContextConfig = {
      ...defaultConfig,
      maxFiles: 2,
      budgetBytes: 100_000,
    };
    const resultFiles = selectFiles(scanned, configFiles);
    const filesOmitted = resultFiles.omitted.files.find((f) => f.path === "packages/c/src/baz.ts");
    expect(filesOmitted!.reason).toBe("max_files_exhausted");

    // budgetBytes will be hit before maxFiles
    const configBytes: ContextConfig = {
      ...defaultConfig,
      maxFiles: 100,
      budgetBytes: 25,
    };
    const resultBytes = selectFiles(scanned, configBytes);
    const bytesOmitted = resultBytes.omitted.files.find((f) => f.path === "packages/d/src/big.ts");
    expect(bytesOmitted!.reason).toBe("budget_exhausted");
  });

  it("fixture WARDROOM.md does not outrank implementation source", () => {
    const scanned: ScannedFile[] = [
      makeFile("fixtures/sample-project/WARDROOM.md", 160),
      makeFile("packages/core/src/engine.ts", 5000),
      makeFile("packages/core/src/turn-loop.ts", 4000),
    ];

    const config: ContextConfig = {
      ...defaultConfig,
      maxFiles: 2,
    };

    const result = selectFiles(scanned, config);
    const selectedPaths = result.selected.map((f) => f.path);

    // Implementation source (priority 5) selected before fixture (priority 11)
    expect(selectedPaths[0]).toBe("packages/core/src/engine.ts");
    expect(selectedPaths[1]).toBe("packages/core/src/turn-loop.ts");

    // Fixture WARDROOM.md omitted
    const omittedPaths = result.omitted.files.map((f) => f.path);
    expect(omittedPaths).toContain("fixtures/sample-project/WARDROOM.md");
  });
});

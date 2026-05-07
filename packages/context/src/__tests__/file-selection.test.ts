import { describe, it, expect } from "vitest";
import type { ContextConfig } from "@roundtable/core";
import { categorizeFile, isHardDenied, isDefaultExcluded, selectFiles } from "../file-selection.js";
import type { ScannedFile } from "../scan-folder.js";

describe("categorizeFile", () => {
  it("categorizes ROUNDTABLE.md as roundtable_config", () => {
    expect(categorizeFile("ROUNDTABLE.md")).toBe("roundtable_config");
  });

  it("categorizes COUNCIL.md as roundtable_config", () => {
    expect(categorizeFile("COUNCIL.md")).toBe("roundtable_config");
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
      makeFile("ROUNDTABLE.md", 150),
      makeFile("docs/guide.md", 300),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const paths = result.selected.map((f) => f.path);

    // ROUNDTABLE.md first (priority 1), README.md next (priority 3),
    // docs/guide.md (priority 5), src/index.ts (priority 6)
    expect(paths[0]).toBe("ROUNDTABLE.md");
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

  it("respects maxFiles", () => {
    const scanned: ScannedFile[] = [
      makeFile("ROUNDTABLE.md", 10),
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
    expect(result.selected[0]!.path).toBe("ROUNDTABLE.md");
    expect(result.selected[1]!.path).toBe("README.md");
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
      makeFile("ROUNDTABLE.md", 100),
      makeFile("README.md", 100),
      makeFile("docs/guide.md", 100),
      makeFile("src/index.ts", 100),
      makeFile("docker-compose.yml", 100),
    ];

    const result = selectFiles(scanned, defaultConfig);
    const byPath = Object.fromEntries(result.selected.map((f) => [f.path, f]));

    expect(byPath["ROUNDTABLE.md"]!.category).toBe("roundtable_config");
    expect(byPath["README.md"]!.category).toBe("project_meta");
    expect(byPath["docs/guide.md"]!.category).toBe("documentation");
    expect(byPath["src/index.ts"]!.category).toBe("source");
    expect(byPath["docker-compose.yml"]!.category).toBe("config");
  });
});

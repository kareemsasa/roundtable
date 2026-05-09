import type { ContextConfig, FileCategory, OmittedReport } from "@wardroom/core";
import { minimatch } from "minimatch";
import type { ScannedFile } from "./scan-folder.js";

export type SelectedFile = {
  path: string;
  category: FileCategory;
  bytes: number;
};

export type SelectionResult = {
  selected: SelectedFile[];
  omitted: OmittedReport;
};

// --- Priority buckets (1 = highest) ---

const WARDROOM_CONFIG_FILES = new Set(["WARDROOM.md", "COUNCIL.md"]);

const AGENT_CONFIG_FILES = new Set(["AGENTS.md", "CLAUDE.md", ".cursorrules"]);

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

const CONFIG_EXACT_FILES = new Set(["docker-compose.yml", "docker-compose.yaml", "Dockerfile"]);

// --- Hard-deny patterns ---

const HARD_DENY_PATTERNS = [
  ".env*",
  "**/.env*",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
  "credentials.*",
  "**/credentials.*",
  "id_rsa*",
  "**/id_rsa*",
  "*.sqlite",
  "**/*.sqlite",
  "*.sqlite3",
  "**/*.sqlite3",
  "*.db",
  "**/*.db",
  "*.duckdb",
  "**/*.duckdb",
];

// --- Default exclusions ---

const EXCLUDED_DIR_PREFIXES = [
  "node_modules/",
  "vendor/",
  "dist/",
  "build/",
  ".next/",
  "target/",
  ".cache/",
  "__pycache__/",
  ".turbo/",
  ".claude/",
  ".worktrees/",
  "coverage/",
];

const EXCLUDED_LOCKFILES = new Set(["pnpm-lock.yaml", "package-lock.json", "yarn.lock"]);

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

const EXCLUDED_BUILD_EXTENSIONS = new Set([".tsbuildinfo"]);

function getExtension(filePath: string): string {
  const basename = filePath.split("/").pop() ?? "";
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex <= 0) return "";
  return basename.slice(dotIndex).toLowerCase();
}

function getBasename(filePath: string): string {
  return filePath.split("/").pop() ?? "";
}

function isBinaryExtension(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filePath));
}

export function categorizeFile(relativePath: string): FileCategory {
  // Fixture/test data files are always low-priority, regardless of basename
  if (relativePath.includes("fixtures/") || relativePath.includes("__fixtures__/")) {
    return "other";
  }

  const basename = getBasename(relativePath);

  if (WARDROOM_CONFIG_FILES.has(basename)) return "wardroom_config";
  if (AGENT_CONFIG_FILES.has(basename)) return "agent_config";
  if (PROJECT_META_FILES.has(basename)) return "project_meta";
  if (CONFIG_EXACT_FILES.has(basename)) return "config";

  // .github/** patterns
  if (relativePath.startsWith(".github/")) return "config";
  // .gitlab-ci** patterns
  if (basename.startsWith(".gitlab-ci")) return "config";

  // docs/**/*.md
  if (relativePath.startsWith("docs/") && relativePath.endsWith(".md")) {
    return "documentation";
  }

  return "source";
}

export function isHardDenied(relativePath: string): boolean {
  for (const pattern of HARD_DENY_PATTERNS) {
    if (minimatch(relativePath, pattern, { dot: true })) {
      return true;
    }
  }
  return false;
}

export function isDefaultExcluded(relativePath: string): boolean {
  // Check directory prefixes (both root-level and nested)
  for (const prefix of EXCLUDED_DIR_PREFIXES) {
    if (relativePath.startsWith(prefix) || relativePath.includes(`/${prefix}`)) return true;
  }

  // Check lockfiles
  if (EXCLUDED_LOCKFILES.has(relativePath)) return true;

  // Check binary extensions
  if (isBinaryExtension(relativePath)) return true;

  // Check build artifact extensions
  if (EXCLUDED_BUILD_EXTENSIONS.has(getExtension(relativePath))) return true;

  return false;
}

function isTestFile(relativePath: string): boolean {
  if (relativePath.includes("__tests__/")) return true;
  const basename = getBasename(relativePath);
  return /\.(test|spec)\.[jt]sx?$/.test(basename);
}

function isRootMeta(relativePath: string): boolean {
  // Root-level files have no directory separator
  return !relativePath.includes("/");
}

function isFixturePath(relativePath: string): boolean {
  return relativePath.includes("fixtures/") || relativePath.includes("__fixtures__/");
}

function isImplementationSource(relativePath: string): boolean {
  // Files under a src/ directory are implementation source in TS/JS monorepos.
  // Matches both "src/..." (single-package) and "packages/foo/src/..." (monorepo).
  // Barrel/index files are excluded — they're typically just re-exports.
  if (!relativePath.includes("src/")) return false;
  const basename = getBasename(relativePath);
  if (/^index\.[jt]sx?$/.test(basename)) return false;
  return true;
}

function priorityOf(category: FileCategory, relativePath: string): number {
  // Fixture/test data files always get lowest priority regardless of category
  if (isFixturePath(relativePath)) return 11;

  switch (category) {
    case "wardroom_config":
      return 1;
    case "agent_config":
      return 2;
    case "project_meta":
      // Root metadata (README.md, package.json, etc.) ranks high;
      // package-level metadata ranks below all production source
      return isRootMeta(relativePath) ? 3 : 8;
    case "config":
      return 4;
    case "documentation":
      // Historical specs/plans rank below production source
      if (relativePath.startsWith("docs/superpowers/")) return 10;
      // General docs rank below implementation source but above peripheral source
      return 6;
    case "source":
      // Test files rank below all production source
      if (isTestFile(relativePath)) return 9;
      // Implementation source (under src/, non-barrel) outranks docs and
      // peripheral source (root configs, barrel index files, non-src files)
      if (isImplementationSource(relativePath)) return 5;
      return 7;
    case "other":
      return 11;
  }
}

export function selectFiles(scanned: ScannedFile[], config: ContextConfig): SelectionResult {
  const selected: SelectedFile[] = [];
  const omittedFiles: { path: string; reason: string }[] = [];

  // Categorize all files and sort by priority
  const categorized = scanned.map((f) => {
    const category = categorizeFile(f.relativePath);
    return {
      scanned: f,
      category,
      priority: priorityOf(category, f.relativePath),
    };
  });

  categorized.sort((a, b) => a.priority - b.priority);

  let totalBytes = 0;

  for (const { scanned: file, category } of categorized) {
    // Hard-deny check (takes precedence over everything, including includes)
    if (isHardDenied(file.relativePath)) {
      omittedFiles.push({ path: file.relativePath, reason: "hard_denied" });
      continue;
    }

    // Default exclusion check
    if (isDefaultExcluded(file.relativePath)) {
      const reason = isBinaryExtension(file.relativePath) ? "binary_file" : "excluded_pattern";
      omittedFiles.push({ path: file.relativePath, reason });
      continue;
    }

    // Custom excludes from config
    if (config.excludes?.length) {
      const excluded = config.excludes.some((pattern) =>
        minimatch(file.relativePath, pattern, { dot: true }),
      );
      if (excluded) {
        omittedFiles.push({ path: file.relativePath, reason: "excluded_pattern" });
        continue;
      }
    }

    // Budget check: maxFiles
    if (selected.length >= config.maxFiles) {
      omittedFiles.push({ path: file.relativePath, reason: "max_files_exhausted" });
      continue;
    }

    // Budget check: budgetBytes
    if (totalBytes + file.bytes > config.budgetBytes) {
      omittedFiles.push({ path: file.relativePath, reason: "budget_exhausted" });
      continue;
    }

    selected.push({
      path: file.relativePath,
      category,
      bytes: file.bytes,
    });
    totalBytes += file.bytes;
  }

  // Build category summary for omitted report
  const categoryCounts = new Map<string, { count: number; reason: string }>();
  for (const omitted of omittedFiles) {
    const key = `${omitted.reason}`;
    const existing = categoryCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      categoryCounts.set(key, { count: 1, reason: omitted.reason });
    }
  }

  const omitted: OmittedReport = {
    categories: Array.from(categoryCounts.entries()).map(([category, { count, reason }]) => ({
      category,
      count,
      reason,
    })),
    files: omittedFiles,
  };

  return { selected, omitted };
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

export type ScannedFile = {
  relativePath: string;
  absolutePath: string;
  bytes: number;
};

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

async function getGitTrackedFiles(targetPath: string): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
      cwd: targetPath,
      maxBuffer: 10 * 1024 * 1024,
    });
    // git ls-files -z uses null byte as separator
    const files = stdout.split("\0").filter((f) => f.length > 0);
    return files.length > 0 ? files : null;
  } catch {
    return null;
  }
}

async function walkDirectory(dir: string, basePath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const subResults = await walkDirectory(fullPath, basePath);
      results.push(...subResults);
    } else if (entry.isFile()) {
      results.push(path.relative(basePath, fullPath));
    }
  }

  return results;
}

export async function scanFolder(targetPath: string): Promise<ScannedFile[]> {
  const resolvedPath = path.resolve(targetPath);

  // Try git-tracked files first; if not a git repo or no tracked files,
  // fall back to recursive filesystem walk
  let relativePaths = await getGitTrackedFiles(resolvedPath);
  if (relativePaths === null) {
    relativePaths = await walkDirectory(resolvedPath, resolvedPath);
  } else {
    // Supplement git-tracked files with a walk to catch gitignored files
    // that need to appear in hard-deny reports (e.g. .env files)
    const walkedPaths = await walkDirectory(resolvedPath, resolvedPath);
    const pathSet = new Set(relativePaths);
    for (const wp of walkedPaths) {
      if (!pathSet.has(wp)) {
        relativePaths.push(wp);
      }
    }
  }

  // Stat each file to get size
  const results: ScannedFile[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(resolvedPath, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      if (stat.isFile()) {
        results.push({
          relativePath,
          absolutePath,
          bytes: stat.size,
        });
      }
    } catch {
      // File may have been deleted between listing and stat; skip it
    }
  }

  return results;
}

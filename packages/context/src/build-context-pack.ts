import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import type {
  ContextConfig,
  ContextFile,
  ContextPack,
  DirectoryTree,
  GitSummary,
} from "@wardroom/core";
import { scanFolder } from "./scan-folder.js";
import { selectFiles } from "./file-selection.js";
import { redactSecrets } from "./redaction.js";

const execFileAsync = promisify(execFile);

async function gatherGitSummary(targetPath: string): Promise<GitSummary | undefined> {
  try {
    // Check if this is a git repo
    await execFileAsync("git", ["rev-parse", "--git-dir"], { cwd: targetPath });
  } catch {
    return undefined;
  }

  try {
    const [branchResult, statusResult, logResult, diffResult] = await Promise.all([
      execFileAsync("git", ["branch", "--show-current"], { cwd: targetPath }).catch(
        () => ({ stdout: "" }) as { stdout: string },
      ),
      execFileAsync("git", ["status", "--short"], { cwd: targetPath }).catch(
        () => ({ stdout: "" }) as { stdout: string },
      ),
      execFileAsync("git", ["log", "--oneline", "-20", "--format=%H|%s|%aI"], {
        cwd: targetPath,
      }).catch(() => ({ stdout: "" }) as { stdout: string }),
      execFileAsync("git", ["diff", "--stat"], { cwd: targetPath }).catch(
        () => ({ stdout: "" }) as { stdout: string },
      ),
    ]);

    const recentCommits = logResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const [hash, message, date] = line.split("|");
        return { hash: hash ?? "", message: message ?? "", date: date ?? "" };
      });

    return {
      branch: branchResult.stdout.trim(),
      status: statusResult.stdout.trim(),
      recentCommits,
      diffStat: diffResult.stdout.trim() || undefined,
    };
  } catch {
    return undefined;
  }
}

async function buildDirectoryTree(
  dir: string,
  name: string,
  depth: number,
  maxDepth: number,
): Promise<DirectoryTree> {
  if (depth >= maxDepth) {
    return { name, type: "directory" };
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
    ".claude",
    ".worktrees",
  ]);

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const children: DirectoryTree[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const subtree = await buildDirectoryTree(
          path.join(dir, entry.name),
          entry.name,
          depth + 1,
          maxDepth,
        );
        children.push(subtree);
      } else if (entry.isFile()) {
        children.push({ name: entry.name, type: "file" });
      }
    }

    return { name, type: "directory", children };
  } catch {
    return { name, type: "directory" };
  }
}

function buildDisplayPath(targetPath: string): string {
  const homedir = os.homedir();
  if (targetPath.startsWith(homedir)) {
    return "~" + targetPath.slice(homedir.length);
  }
  return targetPath;
}

export async function buildContextPack(
  targetPath: string,
  config: ContextConfig,
  version?: number,
): Promise<ContextPack> {
  const resolvedPath = path.resolve(targetPath);

  // 1. Scan folder for files
  const scanned = await scanFolder(resolvedPath);

  // 2. Gather git summary (in parallel with selection since it's independent)
  const [gitSummary, tree] = await Promise.all([
    gatherGitSummary(resolvedPath),
    buildDirectoryTree(resolvedPath, path.basename(resolvedPath), 0, config.maxTreeDepth),
  ]);

  // 3. Select files within budget
  const { selected, omitted } = selectFiles(scanned, config);

  // 4. Read each selected file, truncate if over maxFileBytes, redact secrets
  const files: ContextFile[] = [];
  for (const sel of selected) {
    const absolutePath = path.join(resolvedPath, sel.path);
    try {
      let content = await fs.readFile(absolutePath, "utf-8");
      let truncated = false;

      if (content.length > config.maxFileBytes) {
        content = content.slice(0, config.maxFileBytes);
        truncated = true;
      }

      content = redactSecrets(content);

      files.push({
        path: sel.path,
        category: sel.category,
        content,
        bytes: sel.bytes,
        truncated,
      });
    } catch {
      // File might have been deleted between scan and read; skip it
    }
  }

  // 5. Build display path
  const displayPath = buildDisplayPath(resolvedPath);

  // 6. Return complete ContextPack
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);

  return {
    id: randomUUID(),
    version: version ?? 1,
    targetPath: resolvedPath,
    displayPath,
    createdAt: new Date().toISOString(),
    config,
    tree,
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

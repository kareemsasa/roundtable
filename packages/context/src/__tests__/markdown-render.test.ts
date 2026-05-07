import { describe, it, expect } from "vitest";
import type { ContextPack } from "@roundtable/core";
import { renderContextPackMarkdown } from "../markdown-render.js";

function makePack(overrides?: Partial<ContextPack>): ContextPack {
  return {
    id: "test-id",
    version: 1,
    targetPath: "/home/user/project",
    displayPath: "~/project",
    createdAt: "2026-05-06T00:00:00.000Z",
    config: {
      budgetBytes: 100_000,
      maxFiles: 50,
      maxFileBytes: 10_000,
      maxTreeDepth: 5,
    },
    tree: {
      name: "project",
      type: "directory",
      children: [
        { name: "README.md", type: "file" },
        { name: "src", type: "directory", children: [{ name: "index.ts", type: "file" }] },
      ],
    },
    files: [
      {
        path: "README.md",
        category: "project_meta",
        content: "# My Project\n\nA cool project.",
        bytes: 30,
        truncated: false,
      },
      {
        path: "src/index.ts",
        category: "source",
        content: 'export const hello = "world";',
        bytes: 28,
        truncated: false,
      },
    ],
    omitted: {
      categories: [{ category: "hard_denied", count: 1, reason: "hard_denied" }],
      files: [{ path: ".env", reason: "hard_denied" }],
    },
    stats: {
      totalFiles: 3,
      includedFiles: 2,
      totalBytes: 58,
      budgetBytes: 100_000,
    },
    ...overrides,
  };
}

describe("renderContextPackMarkdown", () => {
  it("includes the context pack header", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("# Context Pack");
  });

  it("includes the target display path", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("~/project");
  });

  it("includes file count stats", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("2 included");
    expect(md).toContain("1 omitted");
  });

  it("includes size stats", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("58 bytes");
    expect(md).toContain("100000");
  });

  it("renders included files with categories", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("### README.md (project_meta)");
    expect(md).toContain("### src/index.ts (source)");
  });

  it("renders file content in code blocks", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("# My Project");
    expect(md).toContain('export const hello = "world";');
  });

  it("includes truncated marker for truncated files", () => {
    const pack = makePack({
      files: [
        {
          path: "big-file.ts",
          category: "source",
          content: "truncated content...",
          bytes: 20000,
          truncated: true,
        },
      ],
    });

    const md = renderContextPackMarkdown(pack);
    expect(md).toContain("[truncated]");
  });

  it("includes omitted files section", () => {
    const md = renderContextPackMarkdown(makePack());
    expect(md).toContain("## Omitted Files");
    expect(md).toContain("`.env`");
    expect(md).toContain("hard_denied");
  });

  it("includes git summary when present", () => {
    const pack = makePack({
      gitSummary: {
        branch: "main",
        status: "M src/index.ts",
        recentCommits: [
          { hash: "abc123", message: "Initial commit", date: "2026-05-06T00:00:00Z" },
        ],
        diffStat: " 1 file changed, 2 insertions(+)",
      },
    });

    const md = renderContextPackMarkdown(pack);
    expect(md).toContain("## Git Summary");
    expect(md).toContain("main");
    expect(md).toContain("abc123");
    expect(md).toContain("Initial commit");
  });

  it("omits git summary section when not present", () => {
    const pack = makePack({ gitSummary: undefined });
    const md = renderContextPackMarkdown(pack);
    expect(md).not.toContain("## Git Summary");
  });
});

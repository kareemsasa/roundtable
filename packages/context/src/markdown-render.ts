import type { ContextPack } from "@roundtable/core";

export function renderContextPackMarkdown(pack: ContextPack): string {
  const lines: string[] = [];

  lines.push("# Context Pack");
  lines.push("");
  lines.push("This is a curated, bounded snapshot of the target folder. It is not");
  lines.push("the full repository. Files were selected by priority within a budget.");
  lines.push("Omitted files are listed below.");
  lines.push("");

  // Target section
  lines.push("## Target");
  lines.push("");
  lines.push(pack.displayPath);
  lines.push("");
  const omittedCount = pack.stats.totalFiles - pack.stats.includedFiles;
  lines.push(`Files: ${pack.stats.includedFiles} included, ${omittedCount} omitted`);
  lines.push(`Size: ${pack.stats.totalBytes} bytes (budget: ${pack.stats.budgetBytes})`);
  lines.push("");

  // Included Files section
  lines.push("## Included Files");
  lines.push("");
  for (const file of pack.files) {
    const truncatedMarker = file.truncated ? " [truncated]" : "";
    lines.push(`### ${file.path} (${file.category})${truncatedMarker}`);
    lines.push("");
    lines.push("```");
    lines.push(file.content);
    lines.push("```");
    lines.push("");
  }

  // Omitted Files section
  if (pack.omitted.files.length > 0) {
    lines.push("## Omitted Files");
    lines.push("");
    for (const omitted of pack.omitted.files) {
      lines.push(`- \`${omitted.path}\`: ${omitted.reason}`);
    }
    lines.push("");
  }

  // Git Summary section
  if (pack.gitSummary) {
    lines.push("## Git Summary");
    lines.push("");
    lines.push(`Branch: ${pack.gitSummary.branch}`);
    lines.push("");

    if (pack.gitSummary.status) {
      lines.push("Status:");
      lines.push("```");
      lines.push(pack.gitSummary.status);
      lines.push("```");
      lines.push("");
    }

    if (pack.gitSummary.recentCommits.length > 0) {
      lines.push("Recent commits:");
      for (const commit of pack.gitSummary.recentCommits) {
        lines.push(`- ${commit.hash} ${commit.message} (${commit.date})`);
      }
      lines.push("");
    }

    if (pack.gitSummary.diffStat) {
      lines.push("Diff stat:");
      lines.push("```");
      lines.push(pack.gitSummary.diffStat);
      lines.push("```");
      lines.push("");
    }
  }

  return lines.join("\n");
}

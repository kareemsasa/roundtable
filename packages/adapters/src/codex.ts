import type { AgentAdapter, AgentInput, AgentEvent, AdapterConfig } from "@roundtable/core";
import { renderContextPackMarkdown } from "@roundtable/context";
import { tmpDir } from "@roundtable/persistence";
import { mkdir, rm } from "node:fs/promises";
import { spawnCliAgent } from "./cli-agent.js";

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

    try {
      const prompt = buildPrompt(input);

      yield* spawnCliAgent({
        command: this.config.command,
        args: [
          "exec",
          "--sandbox",
          "read-only",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--cd",
          cwd,
          "-", // read prompt from stdin
        ],
        cwd,
        timeoutMs: this.config.limits.invocationTimeoutMs,
        maxOutputBytes: this.config.limits.maxOutputBytes,
        gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
        signal,
        stdin: prompt,
      });
    } finally {
      // Clean up temp dir
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function buildPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript
    .map((t) => `${t.participant}: ${t.content}`)
    .join("\n\n");

  const parts: string[] = [];

  // Include the system prompt as instructions (Codex exec doesn't have --system-prompt)
  if (input.systemPrompt) {
    parts.push("# Instructions");
    parts.push(input.systemPrompt);
  }

  parts.push("# Context Pack");
  parts.push(contextMd);

  if (input.transcript.length > 0) {
    parts.push("# Transcript");
    parts.push(transcriptText);
  }

  return parts.join("\n\n");
}

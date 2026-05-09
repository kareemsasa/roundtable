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

      for await (const event of spawnCliAgent({
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
          "--json",
          "-", // read prompt from stdin
        ],
        cwd,
        timeoutMs: this.config.limits.invocationTimeoutMs,
        maxOutputBytes: this.config.limits.maxOutputBytes,
        gracefulShutdownMs: this.config.limits.gracefulShutdownMs,
        signal,
        stdin: prompt,
      })) {
        if (event.type === "chunk" && event.stream === "stdout") {
          // Suppress raw JSONL stdout chunks — Codex emits structured JSON
          // events, not display-safe text. The clean assistant text is
          // extracted from item.completed events in response_end instead.
          // See extractCodexResponse() for the observed JSONL format.
          continue;
        } else if (event.type === "response_end") {
          const cleaned = extractCodexResponse(event.content);
          yield { ...event, content: cleaned };
        } else {
          yield event;
        }
      }
    } finally {
      // Clean up temp dir
      await rm(cwd, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Parse Codex --json JSONL output to extract the actual response text.
 *
 * Observed JSONL event sequence (codex exec --json, as of 2026-05-08):
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"..."}}
 *   {"type":"turn.completed","usage":{...}}
 *
 * Codex does not emit incremental text deltas — the full response text
 * arrives only in item.completed. Because of this, Codex output remains
 * display-buffered: stdout chunks are suppressed and the clean text is
 * extracted here on response_end.
 *
 * If Codex adds streaming delta events in the future, the adapter can
 * parse them incrementally and yield display chunks without changing
 * the response_end extraction.
 */
function extractCodexResponse(rawOutput: string): string {
  const lines = rawOutput.trim().split("\n");
  const texts: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "item.completed" && event.item?.text) {
        texts.push(event.item.text);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  // If we found structured response text, use it; otherwise fall back to raw output
  return texts.length > 0 ? texts.join("\n") : rawOutput;
}

function buildPrompt(input: AgentInput): string {
  const contextMd = renderContextPackMarkdown(input.contextPack);
  const transcriptText = input.transcript.map((t) => `${t.participant}: ${t.content}`).join("\n\n");

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

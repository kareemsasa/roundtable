import type { AgentAdapter, AgentEvent, AgentInput } from "../types.js";

export type TestAdapterConfig = {
  id: string;
  response?: string;
  error?: string;
  timeout?: boolean;
  delayMs?: number;
  streamChunks?: boolean;
};

/**
 * Minimal in-process adapter for core tests.
 * Mirrors the behaviour of MockAdapter but lives inside core,
 * so core has no workspace dependency on packages/adapters.
 */
export class TestAdapter implements AgentAdapter {
  readonly id: string;
  private config: TestAdapterConfig;

  constructor(config: TestAdapterConfig) {
    this.id = config.id;
    this.config = config;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const startTime = Date.now();

    yield {
      type: "invocation_started",
      command: `test-${this.id}`,
      pid: Math.floor(Math.random() * 100000),
      timestamp: new Date().toISOString(),
    };

    yield {
      type: "invocation_metadata",
      cwd: "/test/workspace",
      command: `test-${this.id}`,
      args: ["--invocation", input.invocationId],
      envKeys: ["TEST_MODE"],
    };

    if (this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    if (signal?.aborted) {
      yield { type: "timeout", durationMs: Date.now() - startTime, killed: true };
      return;
    }

    if (this.config.timeout) {
      yield { type: "timeout", durationMs: 120000, killed: true };
      return;
    }

    if (this.config.error) {
      yield { type: "error", error: this.config.error, exitCode: 1 };
      return;
    }

    const content = this.config.response ?? "";

    if (this.config.streamChunks) {
      for (const word of content.split(/\s+/).filter((w) => w.length > 0)) {
        yield { type: "chunk", content: word + " ", stream: "stdout" };
      }
    }

    yield {
      type: "response_end",
      content,
      durationMs: Date.now() - startTime,
      exitCode: 0,
    };
  }
}

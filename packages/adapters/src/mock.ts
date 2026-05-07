import type { AgentAdapter, AgentEvent, AgentInput } from "@roundtable/core";

export type MockAdapterConfig = {
  id: string;
  response?: string;
  error?: string;
  timeout?: boolean;
  delayMs?: number;
  streamChunks?: boolean;
};

export class MockAdapter implements AgentAdapter {
  readonly id: string;
  private config: MockAdapterConfig;

  constructor(config: MockAdapterConfig) {
    this.id = config.id;
    this.config = config;
  }

  async *invoke(input: AgentInput, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const startTime = Date.now();

    // 1. Always emit invocation_started
    yield {
      type: "invocation_started",
      command: `mock-${this.id}`,
      pid: Math.floor(Math.random() * 100000),
      timestamp: new Date().toISOString(),
    };

    // 2. Always emit invocation_metadata
    yield {
      type: "invocation_metadata",
      cwd: "/mock/workspace",
      command: `mock-${this.id}`,
      args: ["--invocation", input.invocationId],
      envKeys: ["MOCK_MODE"],
    };

    // 3. If delayMs, wait
    if (this.config.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    // 4. If signal is aborted, yield timeout and return
    if (signal?.aborted) {
      yield {
        type: "timeout",
        durationMs: Date.now() - startTime,
        killed: true,
      };
      return;
    }

    // 5. If timeout config, yield timeout
    if (this.config.timeout) {
      yield {
        type: "timeout",
        durationMs: 120000,
        killed: true,
      };
      return;
    }

    // 6. If error config, yield error
    if (this.config.error) {
      yield {
        type: "error",
        error: this.config.error,
        exitCode: 1,
      };
      return;
    }

    const content = this.config.response ?? "";

    // 7. If streamChunks, yield chunk events for each word
    if (this.config.streamChunks) {
      const words = content.split(/\s+/).filter((w) => w.length > 0);
      for (const word of words) {
        yield {
          type: "chunk",
          content: word + " ",
          stream: "stdout",
        };
      }
    }

    // 8. Yield response_end
    yield {
      type: "response_end",
      content,
      durationMs: Date.now() - startTime,
      exitCode: 0,
    };
  }
}

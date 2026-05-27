import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { WardroomEngine, Session, WardroomConfig, SessionEvent } from "@wardroom/core";
import type { RenderOptions } from "../render.js";

// --- Mock readline ---
// vi.hoisted runs before imports, so mockState is available inside the vi.mock factory.

const mockState = vi.hoisted(() => ({
  lineHandler: null as ((line: string) => void) | null,
  closeHandler: null as (() => void) | null,
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (event === "line") mockState.lineHandler = handler as (line: string) => void;
    },
    once: (event: string, handler: () => void) => {
      if (event === "close") mockState.closeHandler = handler;
    },
    close: () => {},
  }),
}));

import { runInteractive } from "../interactive.js";

// --- Helpers ---

/** Flush microtasks + nextTick so the async loop can advance. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function injectLine(line: string): void {
  mockState.lineHandler!(line);
}

function makeConfig(): WardroomConfig {
  return {
    dataDir: "/tmp/wardroom-test",
    context: { budgetBytes: 100_000, maxFiles: 50, maxFileBytes: 10_000, maxTreeDepth: 5 },
    deliberation: { maxRounds: 2, participantTimeoutMs: 120_000, deliberationTimeoutMs: 600_000 },
    adapters: {
      claude: {
        command: "claude",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      codex: {
        command: "codex",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
      steward: {
        command: "claude",
        mode: "mock" as const,
        limits: {
          invocationTimeoutMs: 120_000,
          maxOutputBytes: 512_000,
          gracefulShutdownMs: 5_000,
        },
      },
    },
  };
}

function makeSession(): Session {
  return {
    meta: {
      id: "rt_test123",
      status: "awaiting_user",
      targetPath: "/tmp/test-project",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      currentContextPackId: "cp_test",
      configSnapshot: makeConfig(),
      participants: [],
    },
    events: [],
  };
}

function makeMockEngine(): WardroomEngine {
  return {
    submitMessage: vi.fn(async function* () {}),
    refreshContext: vi.fn(),
    startSession: vi.fn(),
    resumeSession: vi.fn(),
    archiveSession: vi.fn(),
  } as unknown as WardroomEngine;
}

function makeEvent(participant: string): SessionEvent {
  return {
    id: "evt_test",
    type: "agent_response_end",
    timestamp: new Date().toISOString(),
    sessionId: "rt_test123",
    participant: participant as SessionEvent["participant"],
    data: { content: "mock response" },
  };
}

const renderOptions: RenderOptions = { verbose: false, stream: true };

// --- Tests ---

describe("/stop interactive command", () => {
  let logCalls: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockState.lineHandler = null;
    mockState.closeHandler = null;
    logCalls = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logCalls.push(args.map(String).join(" "));
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("prints informational message when no deliberation is active", async () => {
    const done = runInteractive({
      engine: makeMockEngine(),
      session: makeSession(),
      renderOptions,
      once: false,
    });

    injectLine("/stop");
    await flush();
    injectLine("/exit");
    await done;

    expect(logCalls).toContain("No active deliberation to stop.");
  });

  it("appears in /help output", async () => {
    const done = runInteractive({
      engine: makeMockEngine(),
      session: makeSession(),
      renderOptions,
      once: false,
    });

    injectLine("/help");
    await flush();
    injectLine("/exit");
    await done;

    const helpOutput = logCalls.join("\n");
    expect(helpOutput).toContain("/stop");
    expect(helpOutput).toContain("Interrupt active deliberation");
  });

  it("does not exit the session or call process.exit", async () => {
    const done = runInteractive({
      engine: makeMockEngine(),
      session: makeSession(),
      renderOptions,
      once: false,
    });

    injectLine("/stop");
    await flush();
    injectLine("/exit");
    await done;

    expect(logCalls).toContain("No active deliberation to stop.");
    expect(logCalls).toContain("Exiting.");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("aborts active deliberation when /stop is typed mid-stream", async () => {
    let capturedSignal: AbortSignal | undefined;

    const engine = makeMockEngine();
    (engine.submitMessage as ReturnType<typeof vi.fn>).mockImplementation(async function* (
      _session: unknown,
      _msg: string,
      signal?: AbortSignal,
    ) {
      capturedSignal = signal;
      // Yield one event, then block until aborted
      yield makeEvent("claude");
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const done = runInteractive({
      engine,
      session: makeSession(),
      renderOptions,
      once: false,
    });

    // 1. Inject a user message to start deliberation
    injectLine("What should I work on?");
    await flush();

    // 2. Verify deliberation started and signal was passed
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);

    // 3. Inject /stop while deliberation is active
    injectLine("/stop");

    // abort() fires synchronously — assert immediately
    expect(capturedSignal!.aborted).toBe(true);

    // 4. Let the generator unwind and the loop return to idle
    await flush();

    // 5. Clean exit
    injectLine("/exit");
    await done;
  });

  it("rejects non-stop input during deliberation with a message", async () => {
    const engine = makeMockEngine();
    (engine.submitMessage as ReturnType<typeof vi.fn>).mockImplementation(async function* (
      _session: unknown,
      _msg: string,
      signal?: AbortSignal,
    ) {
      yield makeEvent("claude");
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const done = runInteractive({
      engine,
      session: makeSession(),
      renderOptions,
      once: false,
    });

    // Start deliberation
    injectLine("hello");
    await flush();

    // Type something that isn't /stop during deliberation
    injectLine("another question");

    expect(logCalls).toContain("Deliberation in progress. Type /stop to interrupt.");

    // Clean up: abort then exit
    injectLine("/stop");
    await flush();
    injectLine("/exit");
    await done;
  });

  it("returns to normal prompt after /stop aborts deliberation", async () => {
    const engine = makeMockEngine();
    let callCount = 0;

    (engine.submitMessage as ReturnType<typeof vi.fn>).mockImplementation(async function* (
      _session: unknown,
      _msg: string,
      signal?: AbortSignal,
    ) {
      callCount++;
      yield makeEvent("claude");
      await new Promise<void>((resolve) => {
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    });

    const done = runInteractive({
      engine,
      session: makeSession(),
      renderOptions,
      once: false,
    });

    // First deliberation — abort it
    injectLine("first question");
    await flush();
    injectLine("/stop");
    await flush();

    expect(callCount).toBe(1);

    // Second deliberation — proves the loop recovered
    injectLine("second question");
    await flush();
    injectLine("/stop");
    await flush();

    expect(callCount).toBe(2);

    injectLine("/exit");
    await done;
  });
});

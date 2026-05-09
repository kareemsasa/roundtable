import { spawn } from "node:child_process";
import type { AgentEvent } from "@roundtable/core";
import { AsyncQueue } from "./async-queue.js";

export type SpawnOptions = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  gracefulShutdownMs: number;
  signal?: AbortSignal;
  /** Content to write to the child process stdin before closing it. */
  stdin?: string;
};

export async function* spawnCliAgent(options: SpawnOptions): AsyncGenerator<AgentEvent> {
  const { command, args, cwd, timeoutMs, maxOutputBytes, gracefulShutdownMs, signal } = options;
  const startTime = Date.now();

  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Handle spawn failure (e.g., ENOENT when command does not exist).
  // We track spawn errors so we can yield them after the process closes.
  let spawnError: Error | undefined;
  child.on("error", (err: Error) => {
    spawnError = err;
  });

  // Yield invocation_started immediately
  yield {
    type: "invocation_started",
    command,
    pid: child.pid ?? -1,
    timestamp: new Date().toISOString(),
  };

  // Yield invocation_metadata — log env key names only, filter out npm_ prefixed keys
  const envKeys = Object.keys(process.env).filter((k) => !k.startsWith("npm_"));
  yield {
    type: "invocation_metadata",
    cwd,
    command,
    args,
    envKeys,
  };

  // Write to stdin if provided, then close it
  if (child.stdin) {
    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  }

  // Accumulate full content for the final event (response_end/error).
  // Chunks are streamed via the queue; these accumulators build the complete output.
  let stdoutContent = "";
  let stderrContent = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  let killedByTimeout = false;
  let killedByAbort = false;

  // AsyncQueue bridges push-based data events to pull-based async iteration.
  // Chunks and truncation events are pushed here and yielded immediately.
  const queue = new AsyncQueue<AgentEvent>();

  child.stdout!.on("data", (data: Buffer) => {
    const chunk = data.toString();
    const chunkBytes = data.length;
    stdoutBytes += chunkBytes;

    if (!stdoutTruncated) {
      if (stdoutBytes > maxOutputBytes) {
        // Keep only up to the limit
        const overage = stdoutBytes - maxOutputBytes;
        const keptFromChunk = chunk.slice(0, chunk.length - overage);
        stdoutContent += keptFromChunk;
        stdoutTruncated = true;
        queue.push({
          type: "output_truncated",
          stream: "stdout",
          originalBytes: stdoutBytes,
          keptBytes: maxOutputBytes,
        });
        if (keptFromChunk.length > 0) {
          queue.push({
            type: "chunk",
            content: keptFromChunk,
            stream: "stdout",
          });
        }
      } else {
        stdoutContent += chunk;
        queue.push({
          type: "chunk",
          content: chunk,
          stream: "stdout",
        });
      }
    }
    // After truncation, just accumulate bytes (content already capped)
  });

  child.stderr!.on("data", (data: Buffer) => {
    const chunk = data.toString();
    const chunkBytes = data.length;
    stderrBytes += chunkBytes;

    if (!stderrTruncated) {
      if (stderrBytes > maxOutputBytes) {
        const overage = stderrBytes - maxOutputBytes;
        const keptFromChunk = chunk.slice(0, chunk.length - overage);
        stderrContent += keptFromChunk;
        stderrTruncated = true;
        queue.push({
          type: "output_truncated",
          stream: "stderr",
          originalBytes: stderrBytes,
          keptBytes: maxOutputBytes,
        });
        if (keptFromChunk.length > 0) {
          queue.push({
            type: "chunk",
            content: keptFromChunk,
            stream: "stderr",
          });
        }
      } else {
        stderrContent += chunk;
        queue.push({
          type: "chunk",
          content: chunk,
          stream: "stderr",
        });
      }
    }
  });

  // Set up timeout: SIGTERM first, then SIGKILL after grace period
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const initiateShutdown = (reason: "timeout" | "abort") => {
    if (reason === "timeout") killedByTimeout = true;
    if (reason === "abort") killedByAbort = true;

    child.kill("SIGTERM");
    killTimer = setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, gracefulShutdownMs);
  };

  const timeoutTimer = setTimeout(() => {
    initiateShutdown("timeout");
  }, timeoutMs);

  // Set up AbortSignal handler
  const onAbort = () => {
    initiateShutdown("abort");
  };

  if (signal) {
    if (signal.aborted) {
      initiateShutdown("abort");
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // End the queue when the process closes.
  // Node guarantees all stdio data events fire before close.
  let exitCode: number | null = null;

  child.on("close", (code) => {
    exitCode = code;
    queue.end();
  });

  // If spawn fails entirely (e.g., ENOENT) and close never fires, end after a short delay
  child.on("error", () => {
    setTimeout(() => {
      queue.end(); // idempotent if close already fired
    }, 100);
  });

  // Stream chunks as they arrive
  for await (const event of queue) {
    yield event;
  }

  // Clean up timers and listeners
  clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  if (signal) {
    signal.removeEventListener("abort", onAbort);
  }

  const durationMs = Date.now() - startTime;

  // Yield final event based on outcome
  if (killedByTimeout || killedByAbort) {
    yield {
      type: "timeout",
      durationMs,
      killed: true,
    };
    return;
  }

  // If the spawn itself failed (e.g., ENOENT), yield an error event
  if (spawnError) {
    yield {
      type: "error",
      error: spawnError.message,
      exitCode: exitCode ?? 1,
    };
    return;
  }

  const code = exitCode ?? 1;

  if (code === 0) {
    yield {
      type: "response_end",
      content: stdoutContent,
      durationMs,
      exitCode: code,
      stderr: stderrContent || undefined,
    };
  } else {
    yield {
      type: "error",
      error: stderrContent || `Process exited with code ${code}`,
      stderr: stderrContent || undefined,
      stdout: stdoutContent || undefined,
      exitCode: code,
    };
  }
}

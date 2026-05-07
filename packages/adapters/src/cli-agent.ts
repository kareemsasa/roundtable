import { spawn } from "node:child_process";
import type { AgentEvent } from "@roundtable/core";

export type SpawnOptions = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  gracefulShutdownMs: number;
  signal?: AbortSignal;
};

export async function* spawnCliAgent(options: SpawnOptions): AsyncGenerator<AgentEvent> {
  const { command, args, cwd, timeoutMs, maxOutputBytes, gracefulShutdownMs, signal } = options;
  const startTime = Date.now();

  const child = spawn(command, args, {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Yield invocation_started immediately
  yield {
    type: "invocation_started",
    command,
    pid: child.pid!,
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

  // Collect stdout/stderr and track byte counts
  let stdoutContent = "";
  let stderrContent = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;

  const collectedEvents: AgentEvent[] = [];
  let killedByTimeout = false;
  let killedByAbort = false;

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
        collectedEvents.push({
          type: "output_truncated",
          stream: "stdout",
          originalBytes: stdoutBytes,
          keptBytes: maxOutputBytes,
        });
        if (keptFromChunk.length > 0) {
          collectedEvents.push({
            type: "chunk",
            content: keptFromChunk,
            stream: "stdout",
          });
        }
      } else {
        stdoutContent += chunk;
        collectedEvents.push({
          type: "chunk",
          content: chunk,
          stream: "stdout",
        });
      }
    } else {
      // Already truncated, just track total bytes — update the truncated event's originalBytes
      const lastTruncated = collectedEvents.find(
        (e) => e.type === "output_truncated" && e.stream === "stdout",
      );
      if (lastTruncated && lastTruncated.type === "output_truncated") {
        lastTruncated.originalBytes = stdoutBytes;
      }
    }
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
        collectedEvents.push({
          type: "output_truncated",
          stream: "stderr",
          originalBytes: stderrBytes,
          keptBytes: maxOutputBytes,
        });
        if (keptFromChunk.length > 0) {
          collectedEvents.push({
            type: "chunk",
            content: keptFromChunk,
            stream: "stderr",
          });
        }
      } else {
        stderrContent += chunk;
        collectedEvents.push({
          type: "chunk",
          content: chunk,
          stream: "stderr",
        });
      }
    } else {
      const lastTruncated = collectedEvents.find(
        (e) => e.type === "output_truncated" && e.stream === "stderr",
      );
      if (lastTruncated && lastTruncated.type === "output_truncated") {
        lastTruncated.originalBytes = stderrBytes;
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

  // Wait for process to close
  const { exitCode } = await new Promise<{
    exitCode: number | null;
  }>((resolve) => {
    child.on("close", (code) => {
      resolve({ exitCode: code });
    });
  });

  // Clean up timers and listeners
  if (timeoutTimer) clearTimeout(timeoutTimer);
  if (killTimer) clearTimeout(killTimer);
  if (signal) {
    signal.removeEventListener("abort", onAbort);
  }

  const durationMs = Date.now() - startTime;

  // Yield all collected chunk and truncation events
  for (const event of collectedEvents) {
    yield event;
  }

  // Yield final event based on outcome
  if (killedByTimeout || killedByAbort) {
    yield {
      type: "timeout",
      durationMs,
      killed: true,
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
    };
  } else {
    yield {
      type: "error",
      error: stderrContent || `Process exited with code ${code}`,
      stderr: stderrContent || undefined,
      exitCode: code,
    };
  }
}

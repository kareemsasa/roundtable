import { describe, it, expect } from "vitest";
import { spawnCliAgent } from "../cli-agent.js";
import type { AgentEvent } from "@wardroom/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function collectEvents(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("spawnCliAgent", () => {
  it("happy path: echo command yields started, metadata, chunk, and response_end", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "echo",
        args: ["hello world"],
        cwd: "/tmp",
        timeoutMs: 5000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 1000,
      }),
    );

    const started = events.find((e) => e.type === "invocation_started");
    expect(started).toBeDefined();
    if (started?.type === "invocation_started") {
      expect(started.pid).toBeGreaterThan(0);
      expect(started.command).toBe("echo");
      expect(started.timestamp).toBeTruthy();
    }

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.cwd).toBe("/tmp");
      expect(metadata.args).toEqual(["hello world"]);
      expect(metadata.envKeys).toBeInstanceOf(Array);
    }

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("hello world");
      expect(responseEnd.exitCode).toBe(0);
      expect(responseEnd.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("non-zero exit code produces error event", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "node",
        args: ["-e", "process.exit(42)"],
        cwd: "/tmp",
        timeoutMs: 5000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 1000,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.exitCode).toBe(42);
    }
  });

  it("timeout produces timeout event", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "sleep",
        args: ["10"],
        cwd: "/tmp",
        timeoutMs: 300,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 200,
      }),
    );

    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
    if (timeoutEvent?.type === "timeout") {
      expect(timeoutEvent.killed).toBe(true);
      expect(timeoutEvent.durationMs).toBeGreaterThanOrEqual(250);
    }
  }, 10000);

  it("output truncation yields output_truncated event", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(1000))"],
        cwd: "/tmp",
        timeoutMs: 5000,
        maxOutputBytes: 100,
        gracefulShutdownMs: 1000,
      }),
    );

    const truncated = events.find((e) => e.type === "output_truncated");
    expect(truncated).toBeDefined();
    if (truncated?.type === "output_truncated") {
      expect(truncated.stream).toBe("stdout");
      expect(truncated.originalBytes).toBeGreaterThanOrEqual(1000);
      expect(truncated.keptBytes).toBeLessThanOrEqual(100);
    }

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content.length).toBeLessThanOrEqual(100);
    }
  });

  it("stderr captured in error event", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "node",
        args: ["-e", "process.stderr.write('err msg'); process.exit(1)"],
        cwd: "/tmp",
        timeoutMs: 5000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 1000,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.stderr).toContain("err msg");
      expect(errorEvent.exitCode).toBe(1);
    }
  });

  it("envKeys does not include values or npm_ prefixed keys", async () => {
    const events = await collectEvents(
      spawnCliAgent({
        command: "echo",
        args: ["test"],
        cwd: "/tmp",
        timeoutMs: 5000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 1000,
      }),
    );

    const metadata = events.find((e) => e.type === "invocation_metadata");
    expect(metadata).toBeDefined();
    if (metadata?.type === "invocation_metadata") {
      expect(metadata.envKeys).toBeInstanceOf(Array);
      expect(metadata.envKeys.length).toBeGreaterThan(0);
      // No values leaked — keys should not contain '='
      for (const key of metadata.envKeys) {
        expect(key).not.toContain("=");
      }
      // No npm_ prefixed keys
      for (const key of metadata.envKeys) {
        expect(key).not.toMatch(/^npm_/);
      }
    }
  });

  it("respects custom cwd", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wardroom-test-"));
    const events = await collectEvents(
      spawnCliAgent({
        command: "node",
        args: ["-e", "console.log(process.cwd())"],
        cwd: tempDir,
        timeoutMs: 5000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 1000,
      }),
    );

    const responseEnd = events.find((e) => e.type === "response_end");
    expect(responseEnd).toBeDefined();
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content.trim()).toBe(tempDir);
    }
  });

  it("chunks stream before response_end (not batched)", async () => {
    // Use a process that emits multiple chunks with small delays
    const script = `
      process.stdout.write("chunk1\\n");
      setTimeout(() => { process.stdout.write("chunk2\\n"); }, 30);
      setTimeout(() => { process.stdout.write("chunk3\\n"); }, 60);
      setTimeout(() => process.exit(0), 100);
    `;

    const arrivals: { type: string; time: number }[] = [];
    const start = Date.now();

    for await (const event of spawnCliAgent({
      command: "node",
      args: ["-e", script],
      cwd: "/tmp",
      timeoutMs: 5000,
      maxOutputBytes: 10000,
      gracefulShutdownMs: 1000,
    })) {
      arrivals.push({ type: event.type, time: Date.now() - start });
    }

    const chunkArrivals = arrivals.filter((a) => a.type === "chunk");
    const responseEndArrival = arrivals.find((a) => a.type === "response_end");

    // At least some chunks arrived
    expect(chunkArrivals.length).toBeGreaterThanOrEqual(1);
    expect(responseEndArrival).toBeDefined();

    // All chunks arrived before response_end
    for (const chunk of chunkArrivals) {
      expect(chunk.time).toBeLessThanOrEqual(responseEndArrival!.time);
    }

    // response_end still has the full accumulated content
    const events: AgentEvent[] = [];
    for await (const event of spawnCliAgent({
      command: "node",
      args: ["-e", script],
      cwd: "/tmp",
      timeoutMs: 5000,
      maxOutputBytes: 10000,
      gracefulShutdownMs: 1000,
    })) {
      events.push(event);
    }
    const responseEnd = events.find((e) => e.type === "response_end");
    if (responseEnd?.type === "response_end") {
      expect(responseEnd.content).toContain("chunk1");
      expect(responseEnd.content).toContain("chunk3");
    }
  });

  it("AbortSignal cancellation yields timeout event", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const events = await collectEvents(
      spawnCliAgent({
        command: "sleep",
        args: ["10"],
        cwd: "/tmp",
        timeoutMs: 30000,
        maxOutputBytes: 10000,
        gracefulShutdownMs: 200,
        signal: controller.signal,
      }),
    );

    const timeoutEvent = events.find((e) => e.type === "timeout");
    expect(timeoutEvent).toBeDefined();
    if (timeoutEvent?.type === "timeout") {
      expect(timeoutEvent.killed).toBe(true);
    }
  }, 10000);
});

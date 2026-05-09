import { describe, it, expect } from "vitest";
import { AsyncQueue } from "../async-queue.js";

async function collect<T>(queue: AsyncQueue<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of queue) items.push(item);
  return items;
}

describe("AsyncQueue", () => {
  it("push before pull: items buffered and yielded in order", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    q.end();

    const items = await collect(q);
    expect(items).toEqual([1, 2, 3]);
  });

  it("pull before push: consumer waits for items", async () => {
    const q = new AsyncQueue<string>();

    const collecting = collect(q);

    // Push after a microtask delay
    await Promise.resolve();
    q.push("a");
    q.push("b");
    q.end();

    const items = await collecting;
    expect(items).toEqual(["a", "b"]);
  });

  it("interleaved push and pull", async () => {
    const q = new AsyncQueue<number>();
    const items: number[] = [];

    const consumer = (async () => {
      for await (const item of q) {
        items.push(item);
      }
    })();

    q.push(1);
    await Promise.resolve();
    q.push(2);
    await Promise.resolve();
    q.push(3);
    q.end();

    await consumer;
    expect(items).toEqual([1, 2, 3]);
  });

  it("end() with no items yields nothing", async () => {
    const q = new AsyncQueue<number>();
    q.end();
    const items = await collect(q);
    expect(items).toEqual([]);
  });

  it("end() is idempotent", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.end();
    q.end(); // second call is a no-op
    q.push(2); // ignored after end

    const items = await collect(q);
    expect(items).toEqual([1]);
  });

  it("error() throws in consumer", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.error(new Error("boom"));

    const items: number[] = [];
    await expect(async () => {
      for await (const item of q) {
        items.push(item);
      }
    }).rejects.toThrow("boom");

    // Item before error was still delivered
    expect(items).toEqual([1]);
  });

  it("error() when consumer is waiting", async () => {
    const q = new AsyncQueue<number>();

    const consuming = (async () => {
      const items: number[] = [];
      for await (const item of q) {
        items.push(item);
      }
      return items;
    })();

    await Promise.resolve();
    q.error(new Error("fail"));

    await expect(consuming).rejects.toThrow("fail");
  });

  it("push after end() is ignored", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.end();
    q.push(2);

    const items = await collect(q);
    expect(items).toEqual([1]);
  });

  it("push after error() is ignored", async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.error(new Error("err"));
    q.push(2);

    const items: number[] = [];
    try {
      for await (const item of q) items.push(item);
    } catch {
      // expected
    }
    expect(items).toEqual([1]);
  });
});

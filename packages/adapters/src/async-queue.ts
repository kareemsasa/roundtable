/**
 * A simple async queue that bridges push-based event sources (like Node.js
 * child process `data` events) to pull-based async iteration.
 *
 * Producers call push()/end()/error(). Consumers use `for await...of`.
 */

type QueueItem<T> =
  | { kind: "value"; value: T }
  | { kind: "end" }
  | { kind: "error"; error: Error };

export class AsyncQueue<T> {
  private buffer: QueueItem<T>[] = [];
  private waiting: ((item: QueueItem<T>) => void) | null = null;
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    this.deliver({ kind: "value", value });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.deliver({ kind: "end" });
  }

  error(err: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.deliver({ kind: "error", error: err });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const item =
        this.buffer.length > 0
          ? this.buffer.shift()!
          : await new Promise<QueueItem<T>>((resolve) => {
              this.waiting = resolve;
            });

      if (item.kind === "end") return;
      if (item.kind === "error") throw item.error;
      yield item.value;
    }
  }

  private deliver(item: QueueItem<T>): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve(item);
    } else {
      this.buffer.push(item);
    }
  }
}

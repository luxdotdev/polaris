import { expect, test } from "bun:test";
import { fixture } from "./fixtures.testing.ts";

test("broker close cancels held stderr without waiting for its source finalizer", async () => {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let cancelled = false;
  let release = () => {};

  const finalizer = new Promise<void>((resolve) => {
    release = resolve;
  });

  const stderr = new ReadableStream<Uint8Array>({
    start: (value) => {
      controller = value;
    },
    cancel: () => {
      cancelled = true;

      return finalizer;
    },
  });

  const f = await fixture("ordinary", 10, undefined, undefined, (port) => {
    void port.stderr.cancel();

    return { ...port, stderr };
  });

  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);
    closing = f.broker.close();

    const settled = await Promise.race([
      closing.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 300);
      }),
    ]);

    expect(settled).toBe(true);
    expect(cancelled).toBe(true);
    expect(f.broker.stats().cleanup).toBe(0);
    expect(f.broker.stats().processSlots).toBe(0);
    expect(stderr.locked).toBe(false);
  } finally {
    if (timer !== undefined) clearTimeout(timer);

    if (!cancelled) controller?.close();
    release();
    await closing;
    await f.dispose();
  }
});

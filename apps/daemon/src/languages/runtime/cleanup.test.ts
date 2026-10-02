import { expect, test } from "bun:test";
import { fixture } from "./fixtures.testing.ts";
import { LanguageError } from "@polaris/protocol";
import { rm } from "node:fs/promises";

test("repeated broker close retains permanent owned stop rejection", async () => {
  const stopped = new Error("Owned stop rejection");

  const f = await fixture("ordinary", 10, undefined, undefined, (port) => ({
    ...port,
    stop: async (graceful) => {
      await port.stop(graceful);
      throw stopped;
    },
  }));

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);

    for (let attempt = 0; attempt < 3; attempt++) {
      const error = await f.broker.close().then(
        () => undefined,
        (cause: Error) => cause
      );

      expect(error).toBe(stopped);
      expect(f.broker.stats().cleanup).toBeGreaterThan(0);
      expect(f.broker.stats().processSlots).toBe(1);
    }

    const port = f.processes[0]!;
    await port.exited;
    expect(() => process.kill(port.pid, 0)).toThrow();
    expect(port.stdout.locked).toBe(false);
    expect(port.stderr.locked).toBe(false);
  } finally {
    for (const port of f.processes) await port.stop(false);
    await rm(f.root, { recursive: true, force: true });
  }
});

test("repeated successful broker close settles with no retained cleanup", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);

    for (let attempt = 0; attempt < 3; attempt++) {
      await f.broker.close();
      expect(f.broker.stats().cleanup).toBe(0);
      expect(f.broker.stats().processSlots).toBe(0);
    }
  } finally {
    await f.dispose();
  }
});

test("repeated broker close stays bounded while owned teardown is pending", async () => {
  let release = () => {};

  const finalizer = new Promise<void>((resolve) => {
    release = resolve;
  });

  const f = await fixture("ordinary", 10, undefined, undefined, (port) => ({
    ...port,
    stop: (graceful) => port.stop(graceful).then(() => finalizer),
  }));

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);

    for (let attempt = 0; attempt < 2; attempt++) {
      const reason = await f.broker.close().then(
        () => "success",
        (error: LanguageError) => error.reason
      );

      expect(reason).toBe("timeout");
      expect(f.broker.stats().cleanup).toBeGreaterThan(0);
      expect(f.broker.stats().processSlots).toBe(1);
    }

    release();
    await f.broker.close();
    expect(f.broker.stats().cleanup).toBe(0);
    expect(f.broker.stats().processSlots).toBe(0);
  } finally {
    release();
    await f.dispose();
  }
}, 25000);

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

for (const mode of ["stdout", "both", "reject"]) {
  test(`broker close cleans the actual owned child with ${mode} stream cancellation`, async () => {
    let release = () => {};

    let stdoutCancelled = false;
    let stderrCancelled = false;

    const finalizer = new Promise<void>((resolve) => {
      release = resolve;
    });

    const cancellation = () =>
      mode === "reject"
        ? Promise.reject(new Error("Owned stream cancellation rejected"))
        : finalizer;

    const f = await fixture("ordinary", 10, undefined, undefined, (port) => {
      const reader = port.stdout.getReader();

      const stdout = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          const value = await reader.read();

          if (stdoutCancelled) return;

          if (value.done) {
            controller.close();
            reader.releaseLock();
          } else controller.enqueue(value.value);
        },
        cancel: () => {
          stdoutCancelled = true;
          void reader
            .cancel()
            .catch(() => {})
            .then(() => reader.releaseLock());

          return cancellation();
        },
      });

      if (mode === "stdout") return { ...port, stdout };
      void port.stderr.cancel();

      const stderr = new ReadableStream<Uint8Array>({
        cancel: () => {
          stderrCancelled = true;

          return cancellation();
        },
      });

      return { ...port, stdout, stderr };
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    let closing: Promise<void> | undefined;

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
      expect(stdoutCancelled).toBe(true);
      expect(stderrCancelled).toBe(mode !== "stdout");
      expect(f.broker.stats().cleanup).toBe(0);
      expect(f.broker.stats().processSlots).toBe(0);

      for (const port of f.processes) {
        await port.exited;
        expect(() => process.kill(port.pid, 0)).toThrow();
        expect(port.stdout.locked).toBe(false);
        expect(port.stderr.locked).toBe(false);
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
      await closing;
      await f.dispose();
    }
  });
}

test("close deadline rejects while actual teardown remains owned until settlement", async () => {
  let release = () => {};

  const finalizer = new Promise<void>((resolve) => {
    release = resolve;
  });

  const f = await fixture("ordinary", 10, undefined, undefined, (port) => ({
    ...port,
    stop: (graceful) => port.stop(graceful).then(() => finalizer),
  }));

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);

    const reason = await f.broker.close().then(
      () => "success",
      (error: LanguageError) => error.reason
    );

    expect(reason).toBe("timeout");
    expect(f.broker.stats().cleanup).toBeGreaterThan(0);
    expect(f.broker.stats().processSlots).toBe(1);
    release();
    await f.broker.close();
    expect(f.broker.stats().cleanup).toBe(0);
    expect(f.broker.stats().processSlots).toBe(0);
  } finally {
    release();
    await f.dispose();
  }
}, 15000);

import { expect, test } from "bun:test";
import { OrderedConnection } from "./index.ts";

for (const rejects of [false, true]) {
  test(`close stops the owned port when stdout cancellation ${rejects ? "rejects" : "stalls"}`, async () => {
    let release = () => {};

    let cancelled = false;
    let stopped = 0;

    const finalizer = new Promise<void>((resolve) => {
      release = resolve;
    });

    const stdout = new ReadableStream<Uint8Array>({
      cancel: () => {
        cancelled = true;

        return rejects ? Promise.reject(new Error("Owned cancellation rejection")) : finalizer;
      },
    });

    const connection = new OrderedConnection(
      {
        stdout,
        stderr: new ReadableStream({ start: (controller) => controller.close() }),
        pid: 0,
        exited: Promise.resolve(0),
        write: async () => {},
        stop: async () => {
          stopped++;
        },
      },
      () => {},
      () => {}
    );

    let timer: ReturnType<typeof setTimeout> | undefined;
    const closing = connection.close();

    try {
      const settled = await Promise.race([
        closing.then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), 300);
        }),
      ]);

      expect(settled).toBe(true);
      expect(connection.close()).toBe(closing);
      expect(cancelled).toBe(true);
      expect(stopped).toBe(1);
      expect(stdout.locked).toBe(false);
      expect(connection.stats()).toEqual({ queued: 0, queuedBytes: 0, pending: 0 });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release();
      await closing;
    }
  });
}

test("close reports owned stop failure instead of claiming successful cleanup", async () => {
  const connection = new OrderedConnection(
    {
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      pid: 0,
      exited: Promise.resolve(0),
      write: async () => {},
      stop: async () => {
        throw new Error("Owned stop failed");
      },
    },
    () => {},
    () => {}
  );

  const error = await connection.close().then(
    () => undefined,
    (cause: Error) => cause.message
  );

  expect(error).toBe("Owned stop failed");
});

test("close waits for owned stop settlement before reporting completion", async () => {
  let release = () => {};

  let settled = false;

  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });

  const connection = new OrderedConnection(
    {
      stdout: new ReadableStream(),
      stderr: new ReadableStream(),
      pid: 0,
      exited: Promise.resolve(0),
      write: async () => {},
      stop: () => stopped,
    },
    () => {},
    () => {}
  );

  const closing = connection.close().then(() => {
    settled = true;
  });

  try {
    await Bun.sleep(10);
    expect(settled).toBe(false);
    release();
    await closing;
    expect(settled).toBe(true);
  } finally {
    release();
    await closing;
  }
});

import { expect, test } from "bun:test";
import { Predicate } from "effect";
import { ServerLogs } from "./logs.ts";
import { fixture } from "./fixtures.testing.ts";

test("log ring bounds line count, UTF-8 bytes and individual lines", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();

    const logs = new ServerLogs(context);

    for (let i = 0; i < 2100; i++) logs.append("logMessage", "info", String(i));

    expect(logs.stats().lines).toBe(2000);

    const backlog = await logs.watch().next();

    if (backlog.done || !Predicate.isTagged(backlog.value, "Snapshot"))
      throw new Error("No backlog");

    expect(backlog.value.lines[0]?.text).toBe("100");
    logs.close();

    expect(logs.stats()).toEqual({ lines: 0, bytes: 0, subscribers: 0 });

    const bytes = new ServerLogs(context);

    for (let i = 0; i < 1000; i++) bytes.append("stderr", "warning", "🙂".repeat(10000));

    expect(bytes.stats().bytes).toBeLessThanOrEqual(512 * 1024);

    expect(bytes.stats().lines).toBeLessThanOrEqual(64);
    expect(bytes.stats().lines).toBeGreaterThan(0);

    const snapshot = await bytes.watch().next();

    if (snapshot.done || !Predicate.isTagged(snapshot.value, "Snapshot"))
      throw new Error("No backlog");

    expect(snapshot.value.lines.every((line) => Buffer.byteLength(line.text) <= 8192)).toBe(true);
    bytes.close();
  } finally {
    await f.dispose();
  }
});

test("log backlog and live delivery are atomic; slow subscribers and cancellation release slots", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();

    const logs = new ServerLogs(context);
    logs.append("logMessage", "info", "backlog");

    const feed = logs.watch();
    logs.append("showMessage", "error", "live");

    expect((await feed.next()).value).toMatchObject({
      lines: [{ text: "backlog" }],
    });

    expect((await feed.next()).value).toMatchObject({
      line: { text: "live", sequence: 2 },
    });

    const waiting = feed.next();

    await feed.return?.();

    expect((await waiting).done).toBe(true);

    expect(logs.stats().subscribers).toBe(0);

    const controller = new AbortController();

    const abortable = logs.watch(controller.signal);

    await abortable.next();

    const pending = abortable.next();
    controller.abort();

    expect((await pending).done).toBe(true);

    expect(logs.stats().subscribers).toBe(0);

    const slow = logs.watch();

    for (let i = 0; i < 256; i++) logs.append("logMessage", "info", "overflow");

    await Promise.resolve(expect(slow.next()).rejects.toMatchObject({ reason: "queue-full" }));

    expect(logs.stats().subscribers).toBe(0);

    for (let i = 0; i < 16; i++) logs.watch();

    expect(() => logs.watch()).toThrow();
    logs.close();
  } finally {
    await f.dispose();
  }
});

test("broker logs are private to Client/checkout and close on restart or disconnect", async () => {
  const f = await fixture("logs");

  try {
    const { context } = await f.acquire();

    expect(() => f.broker.watchLog("one", context)).toThrow();

    await f.open("one", context);

    await f.ready("one", context);

    const controller = new AbortController();

    const timeout = setTimeout(() => controller.abort(), 5000);

    const source = f.broker.watchLog("one", context, controller.signal);

    const lines: string[] = [];

    try {
      for await (const event of source) {
        expect(event.context).toEqual(context);

        if (Predicate.isTagged(event, "Snapshot"))
          lines.push(...event.lines.map((line) => line.text));
        else lines.push(event.line.text);

        if (lines.length >= 3) break;
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }

    expect(lines).toContain("private fixture log");

    expect(lines).toContain("private fixture show");

    expect(lines).toContain("private fixture stderr");

    expect(() => f.broker.watchLog("two", context)).toThrow();

    expect(() => f.broker.watchLog("one", { ...context, checkout: f.worktree })).toThrow();

    const publicFeed = f.broker.watch("one", context)[Symbol.asyncIterator]();

    const initial = await publicFeed.next();

    expect(JSON.stringify(initial.value)).not.toContain("private fixture");

    await publicFeed.return?.();

    const retired = f.broker.watchLog("one", context);

    await retired.next();

    const waiting = retired.next();

    const restarted = await f.broker.restart("one", context);

    expect((await waiting).done).toBe(true);

    expect(() => f.broker.watchLog("one", context)).toThrow();

    await f.ready("one", restarted.context);

    const next = f.broker.watchLog("one", restarted.context);

    const backlog = await next.next();

    if (backlog.done || !Predicate.isTagged(backlog.value, "Snapshot"))
      throw new Error("No restart backlog");

    if (backlog.value.lines.length === 0) {
      const first = await next.next();

      if (first.done || !Predicate.isTagged(first.value, "Line"))
        throw new Error("No restart line");

      expect(first.value.line.sequence).toBe(1);
    } else expect(backlog.value.lines[0]?.sequence).toBe(1);

    await f.broker.disconnectAndWait("one");

    expect((await next.next()).done).toBe(true);
  } finally {
    await f.dispose();
  }
});

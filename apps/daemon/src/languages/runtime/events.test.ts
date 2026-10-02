import { expect, test } from "bun:test";
import { ContextEvents } from "./events.ts";
import { fixture } from "./fixtures.testing.ts";

test("pending subscriber return and abort release all slots without another event", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    const source = f.broker.watch("one", context)[Symbol.asyncIterator]();
    const snapshot = await source.next();

    if (snapshot.done) throw new Error("Missing snapshot");
    await source.return?.();
    const events = new ContextEvents();

    for (let i = 0; i < 32; i++) {
      const iterator = events.watch(snapshot.value)[Symbol.asyncIterator]();
      await iterator.next();
      const waiting = iterator.next();
      await iterator.return?.();
      expect((await waiting).done).toBe(true);
    }

    const controller = new AbortController();
    const iterator = events.watch(snapshot.value, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();
    const waiting = iterator.next();
    controller.abort();
    expect((await waiting).done).toBe(true);
    const slow = events.watch(snapshot.value)[Symbol.asyncIterator]();

    for (let i = 0; i < 256; i++) events.emit(snapshot.value);
    expect(
      await slow.next().then(
        () => false,
        () => true
      )
    ).toBe(true);

    for (let i = 0; i < 16; i++) events.watch(snapshot.value);
    events.close();
  } finally {
    await f.dispose();
  }
});

import { expect, test } from "bun:test";
import { ClientSettlement } from "./clientSettlement.ts";
import { fixture } from "./fixtures.testing.ts";

function held() {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
}

test("Client drain waits its late owned teardown and never another Client", async () => {
  const owner = new ClientSettlement();
  const before = held();
  const own = held();
  const other = held();
  let settled = false;

  owner.track("other", other.promise);

  const waiting = owner.wait("one", [before.promise]).then(() => {
    settled = true;
  });

  owner.track("one", own.promise);
  before.release();
  await Promise.resolve();
  expect(settled).toBe(false);
  own.release();
  await waiting;
  expect(settled).toBe(true);
  other.release();
});

test("owned stop rejection and elapsed deadline are never successful settlement", async () => {
  const owner = new ClientSettlement();
  const failure = new Error("Owned stop rejected");

  owner.track("failed", Promise.reject(failure), true);

  const rejection = await owner.wait("failed", []).catch((cause: unknown) => cause);

  expect(rejection).toBe(failure);

  const pending = held();

  owner.track("pending", pending.promise);

  const timeout = await owner.wait("pending", [], 10).then(
    () => false,
    () => true
  );

  expect(timeout).toBe(true);
  pending.release();
  await owner.wait("pending", []);
});

test("scoped disconnect retires immediately but waits owned process stop, keeping other context", async () => {
  const stopped = held();

  const f = await fixture("ordinary", 10, undefined, undefined, (port) => ({
    ...port,
    stop: (graceful) => port.stop(graceful).then(() => stopped.promise),
  }));

  try {
    const first = await f.acquire();
    const other = await f.acquire("other");

    await f.open("one", first.context);
    await f.ready("one", first.context);

    let settled = false;

    const waiting = f.broker.disconnectAndWait("one").then(() => {
      settled = true;
    });

    expect(() => f.broker.snapshot("one", first.context)).toThrow();
    expect(f.broker.snapshot("other", other.context).context).toEqual(other.context);
    await Promise.resolve();
    expect(settled).toBe(false);
    stopped.release();
    await waiting;
    expect(settled).toBe(true);
    expect(f.broker.stats().contexts).toBe(1);
    expect(f.broker.stats().processSlots).toBe(0);
  } finally {
    stopped.release();
    await f.dispose();
  }
});

test("scoped disconnect awaits canceled discovery without allowing a late context", async () => {
  const discovery = held();
  const f = await fixture("ordinary", 10, undefined, discovery.promise);

  try {
    const acquisition = f.acquire().then(
      () => false,
      () => true
    );

    let settled = false;

    const waiting = f.broker.disconnectAndWait("one").then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    discovery.release();
    expect(await acquisition).toBe(true);
    await waiting;
    expect(f.broker.stats().contexts).toBe(0);
    expect(f.broker.stats().acquiring).toBe(0);
  } finally {
    discovery.release();
    await f.dispose();
  }
});

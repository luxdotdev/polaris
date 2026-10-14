import { expect, test } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import {
  LanguageDocumentNotification,
  LanguageRuntime,
  LanguageEffectiveSettings,
  LanguageError,
} from "@polaris/protocol";
import { Predicate } from "effect";
import { fixture } from "./fixtures.testing.ts";

type Fixture = Awaited<ReturnType<typeof fixture>>;

test("an unspawned cancellation with renewed demand preserves the draft without spending crash retries", async () => {
  const events: string[] = [];

  const f = await fixture(
    "ordinary",
    60000,
    ({ event }) => events.push(event.type),
    undefined,
    undefined,
    false,
    {
      processLimit: 1,
      failAdmissionOnce: new LanguageError({
        reason: "stale-generation",
        message: "Demand changed before cancellation settled",
        retryable: false,
      }),
    }
  );

  try {
    const initial = await f.acquire();
    await f.open("one", initial.context, "renewed unsaved draft");
    await until(async () => Predicate.isTagged((await f.acquire()).runtime, "Ready"));
    const current = await f.acquire();
    expect(current.context.generation).toBeGreaterThan(initial.context.generation);
    expect(current.ack.acceptedSequence).toBe(1);
    expect(current.ack.documents).toHaveLength(1);
    expect(events).not.toContain("crash");
    expect(f.processes).toHaveLength(1);
    expect(f.broker.stats().processSlots).toBe(1);
  } finally {
    await f.dispose();
  }
});

async function closed(f: Fixture, client: string, context: Parameters<Fixture["open"]>[1]) {
  return f.broker.sync(client, {
    context,
    sequence: 2,
    notification: LanguageDocumentNotification.cases.Close.make({ uri: f.uri, version: 1 }),
  });
}

async function until(check: () => boolean | Promise<boolean>, milliseconds = 2000) {
  for (const deadline = Date.now() + milliseconds; Date.now() < deadline;) {
    if (await check()) return;
    await Bun.sleep(5);
  }

  throw new Error("Process admission deadline");
}

test("Host pressure evicts the oldest idle provider through Evict, then reopening evicts the next idle provider", async () => {
  const events: string[] = [];

  const f = await fixture(
    "ordinary",
    60000,
    ({ event }) => events.push(event.type),
    undefined,
    undefined,
    false,
    { processLimit: 2 }
  );

  try {
    const a = await f.acquire("a", "a", "fake-a");
    const b = await f.acquire("b", "b", "fake-b");
    await f.open("a", a.context);
    await f.ready("a", a.context);
    await f.open("b", b.context);
    await f.ready("b", b.context);
    await closed(f, "a", a.context);
    await closed(f, "b", b.context);
    const c = await f.acquire("c", "c", "fake-c");
    await f.open("c", c.context);
    await f.ready("c", c.context);
    const retired = await f.acquire("a", "a", "fake-a");
    expect(retired.runtime).toMatchObject(
      LanguageRuntime.cases.Stopped.make({ reason: "process-budget" })
    );
    expect(retired.context.generation).toBeGreaterThan(a.context.generation);
    expect(retired.ack.acceptedSequence).toBe(2);
    expect(retired.ack.documents).toHaveLength(0);
    expect((await f.acquire("b", "b", "fake-b")).runtime._tag).toBe("Ready");
    await f.broker.sync("a", {
      context: retired.context,
      sequence: 3,
      notification: LanguageDocumentNotification.cases.Open.make({
        uri: f.uri,
        version: 2,
        text: "reopened",
        languageId: "typescript",
      }),
    });
    await f.ready("a", retired.context);
    expect((await f.acquire("b", "b", "fake-b")).runtime).toMatchObject(
      LanguageRuntime.cases.Stopped.make({ reason: "process-budget" })
    );
    expect(events.filter((event) => event === "evict")).toHaveLength(2);
    expect(f.broker.stats().processSlots).toBe(2);
    expect(f.processes).toHaveLength(4);
  } finally {
    await f.dispose();
  }
});

test("an active independent configuration does not pin an idle context of the same provider", async () => {
  const f = await fixture("ordinary", 60000, undefined, undefined, undefined, false, {
    processLimit: 2,
  });

  try {
    const old = await f.acquire("old");
    await f.open("old", old.context);
    await f.ready("old", old.context);

    const peer = await f.broker.acquire("peer", {
      clientId: "peer",
      contextId: "peer",
      checkout: f.checkout,
      path: join(f.root, "file.ts"),
      providerId: "fake",
      interestId: "file",
      settings: LanguageEffectiveSettings.make({ ...f.settings, revision: 1 }),
    });

    await f.open("peer", peer.context);
    await f.ready("peer", peer.context);
    await closed(f, "old", old.context);
    const next = await f.acquire("next", "next", "fake-new");
    await f.open("next", next.context);
    await f.ready("next", next.context);
    expect((await f.acquire("old")).runtime).toMatchObject(
      LanguageRuntime.cases.Stopped.make({ reason: "process-budget" })
    );
    expect(f.broker.snapshot("peer", peer.context).runtime._tag).toBe("Ready");
  } finally {
    await f.dispose();
  }
});

test("retirement timeout retains capacity and spends no crash retries", async () => {
  const gate = Promise.withResolvers<void>();

  const f = await fixture(
    "ordinary",
    60000,
    undefined,
    undefined,
    (port) => ({
      ...port,
      stop: async (graceful) => {
        await port.stop(graceful);
        await gate.promise;
      },
    }),
    false,
    // Short stand-ins for the 10 s connection close and retirement deadlines, in the same order.
    { processLimit: 1, connectionCloseDeadlineMs: 150, retirementDeadlineMs: 300 }
  );

  try {
    const old = await f.acquire("old");
    await f.open("old", old.context);
    await f.ready("old", old.context);
    await closed(f, "old", old.context);
    const next = await f.acquire("next", "next", "fake-new");
    await f.open("next", next.context);
    await until(() =>
      Predicate.isTagged(f.broker.snapshot("next", next.context).runtime, "Failed")
    );
    const runtime = f.broker.snapshot("next", next.context).runtime;
    expect(runtime).toMatchObject({
      attempts: 0,
      retryAt: null,
      failure: { reason: "process-retiring" },
    });
    expect(f.broker.stats().processSlots).toBe(1);

    const stopping = await f.broker.close().then(
      () => null,
      (cause: unknown) => cause
    );

    expect(stopping).toMatchObject({ reason: "timeout" });
    expect(f.broker.stats().processSlots).toBe(1);
    gate.resolve();
    await until(() => f.broker.stats().processSlots === 0);
  } finally {
    gate.resolve();

    const cleanup = await f.dispose().then(
      () => null,
      (cause: unknown) => cause
    );

    expect(cleanup).toMatchObject({ reason: "timeout" });
    await rm(f.root, { recursive: true, force: true });
  }
});

test("active documents in any Client protect the provider; all-busy refusal spends no crash budget", async () => {
  const f = await fixture("ordinary", 60000, undefined, undefined, undefined, false, {
    processLimit: 2,
  });

  try {
    const a = await f.acquire("a", "a", "fake-shared");
    const peer = await f.acquire("peer", "peer", "fake-shared");
    await f.open("a", a.context);
    await f.ready("a", a.context);
    await f.open("peer", peer.context);
    await f.ready("peer", peer.context);
    await closed(f, "a", a.context);
    const c = await f.acquire("c", "c", "fake-new");
    await f.open("c", c.context);
    await until(() => Predicate.isTagged(f.broker.snapshot("c", c.context).runtime, "Failed"));
    const failed = f.broker.snapshot("c", c.context).runtime;

    if (!Predicate.isTagged(failed, "Failed")) throw new Error("Missing active-use refusal");
    expect(failed.attempts).toBe(0);
    expect(failed.retryAt).toBeNull();
    expect(failed.failure?.reason).toBe("process-limit");
    expect(f.processes).toHaveLength(2);
    expect(f.broker.stats().processSlots).toBe(2);
    f.broker.setProcessLimit(1);
    expect(f.broker.stats().processSlots).toBe(2);
    expect(f.broker.snapshot("peer", peer.context).runtime._tag).toBe("Ready");
  } finally {
    await f.dispose();
  }
});

test("eviction retains capacity until raw teardown settles, and closing waiting demand cannot leak a reservation", async () => {
  let finish!: () => void;

  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const f = await fixture(
    "ordinary",
    60000,
    undefined,
    undefined,
    (port) => ({
      ...port,
      stop: async (graceful) => {
        await port.stop(graceful);
        await gate;
      },
    }),
    false,
    { processLimit: 1 }
  );

  try {
    const a = await f.acquire("a", "a", "fake-old");
    await f.open("a", a.context);
    await f.ready("a", a.context);
    await closed(f, "a", a.context);
    const c = await f.acquire("c", "c", "fake-new");
    await f.open("c", c.context);
    await until(() => f.broker.stats().processes === 0);
    expect(f.broker.stats().processSlots).toBe(1);
    expect(f.processes).toHaveLength(1);
    await closed(f, "c", c.context);
    finish();
    await until(() => f.broker.stats().processSlots === 0);
    expect(f.processes).toHaveLength(1);
    expect((await f.acquire("c", "c", "fake-new")).runtime).toMatchObject(
      LanguageRuntime.cases.Stopped.make({ reason: "no-demand" })
    );
  } finally {
    finish();
    await f.dispose();
  }
});

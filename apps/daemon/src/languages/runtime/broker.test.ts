import { expect, test } from "bun:test";
import { Schema } from "effect";
import {
  LanguageError,
  LanguageRuntime,
  LanguageContextEvent,
  LanguageDocumentNotification,
  LanguageFeatureRequest,
  LanguageFeatureResult,
  LanguageSyncInput,
} from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import { fixture } from "./fixtures.testing.ts";

function hover(
  context: LanguageContextIdentity,
  uri: string,
  requestId = "hover",
  version = 1,
  sequence = 1,
  slow = false
) {
  return LanguageFeatureRequest.make({
    requestId,
    fence: { context, requiredSequence: sequence, documents: [{ uri, version }] },
    method: "textDocument/hover",
    params: { textDocument: { uri }, slow },
    deadline: Date.now() + 1000,
  });
}

test("demand-only startup, initialization configuration and typed ordered ack", async () => {
  const f = await fixture("slow-init");

  try {
    const { context } = await f.acquire();
    expect(f.processes).toHaveLength(0);
    const ack = await f.open("one", context);
    expect(ack.acceptedSequence).toBe(1);
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Change.make({
          uri: f.uri,
          previousVersion: 1,
          version: 2,
          changes: [{ text: "new😀" }],
        }),
      })
    );
    await f.ready("one", context);
    const result = await f.broker.request("one", hover(context, f.uri, "hover", 2, 2));
    expect(Schema.is(LanguageFeatureResult)(result)).toBe(true);

    const value = Schema.decodeUnknownSync(
      Schema.Struct({
        text: Schema.String,
        version: Schema.Int,
        received: Schema.Array(Schema.String),
        configuration: Schema.Array(Schema.Json),
      })
    )(result.result);

    expect(value.text).toBe("new😀");
    expect(value.version).toBe(2);
    expect(value.received.indexOf("initialized")).toBeLessThan(
      value.received.indexOf("textDocument/didOpen")
    );
    expect(value.received.filter((x) => x === "textDocument/didOpen")).toHaveLength(1);
    expect(value.configuration).toEqual(["configured", null]);
  } finally {
    await f.dispose();
  }

  expect(f.processes.every((port) => port.exited !== undefined)).toBe(true);
});

test("two Clients share installed executable but never draft content or context ownership", async () => {
  const f = await fixture();

  try {
    const first = await f.acquire("one");
    const second = await f.acquire("two");
    await Promise.all([
      f.open("one", first.context, "one private"),
      f.open("two", second.context, "two private"),
    ]);
    await Promise.all([f.ready("one", first.context), f.ready("two", second.context)]);
    const a = await f.broker.request("one", hover(first.context, f.uri));
    const b = await f.broker.request("two", hover(second.context, f.uri));
    expect(a.result).toHaveProperty("text", "one private");
    expect(b.result).toHaveProperty("text", "two private");
    await rejects(f.broker.request("two", hover(first.context, f.uri)), "not-owner");
    expect(f.processes).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

test("typing invalidates in-flight results; explicit cancel and stale queue cuts reject", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);
    const pending = f.broker.request("one", hover(context, f.uri, "slow", 1, 1, true));

    const rejected = pending.then(
      () => "resolved",
      (error: LanguageError) => Schema.decodeUnknownSync(LanguageError)(error).reason
    );

    await Bun.sleep(5);
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Change.make({
          uri: f.uri,
          previousVersion: 1,
          version: 2,
          changes: [{ text: "changed" }],
        }),
      })
    );
    expect(await rejected).toBe("cancelled");
    await rejects(f.broker.request("one", hover(context, f.uri)), "stale-document");
    const cancellation = f.broker.request("one", hover(context, f.uri, "cancel", 2, 2, true));

    const cancelled = cancellation.then(
      () => "resolved",
      (error: LanguageError) => Schema.decodeUnknownSync(LanguageError)(error).reason
    );

    await Bun.sleep(5);
    f.broker.cancel("one", context, "cancel");
    expect(await cancelled).toBe("cancelled");
    const controller = new AbortController();
    controller.abort();
    await rejects(
      f.broker.request("one", hover(context, f.uri, "aborted", 2, 2), controller.signal),
      "cancelled"
    );
    await rejects(f.broker.request("one", hover(context, f.uri, "future", 2, 3)), "stale-document");
  } finally {
    await f.dispose();
  }
});

test("restart/disconnect/reconnect clear snapshots and generation-bound operations", async () => {
  const f = await fixture();

  try {
    const original = await f.acquire();
    await f.open("one", original.context);
    await f.ready("one", original.context);
    const restart = await f.broker.restart("one", original.context);
    expect(restart.context.generation).toBeGreaterThan(original.context.generation);
    expect(restart.ack.documents).toHaveLength(0);
    await rejects(f.broker.request("one", hover(original.context, f.uri)), "stale-generation");
    f.broker.disconnect("one");
    const reconnected = await f.acquire();
    expect(reconnected.context.generation).toBeGreaterThan(restart.context.generation);
    expect(reconnected.ack.acceptedSequence).toBe(0);
    await f.open("one", reconnected.context, "fresh");
    await f.ready("one", reconnected.context);
    expect(
      (await f.broker.request("one", hover(reconnected.context, f.uri))).result
    ).toHaveProperty("text", "fresh");
  } finally {
    await f.dispose();
  }
});

test("open documents retain process across view release; last close cleans process after grace", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    await f.ready("one", context);
    await f.broker.release("one", context, "file");
    await Bun.sleep(20);
    expect(f.broker.stats().processes).toBe(1);
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Close.make({ uri: f.uri, version: 1 }),
      })
    );

    for (let i = 0; i < 100 && (f.broker.stats().cleanup > 0 || f.broker.stats().contexts > 0); i++)
      await Bun.sleep(10);
    expect(f.broker.stats().contexts).toBe(0);
    expect(f.broker.stats().cleanup).toBe(0);
    expect(await f.processes[0]!.exited).toBe(0);
  } finally {
    await f.dispose();
  }
});

test("trust revocation fences long-lived generations and prevents any untrusted spawn", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    f.revoke();
    await rejects(f.open("one", context), "stale-generation");
    expect(f.processes).toHaveLength(0);
    const next = await f.acquire();
    await rejects(f.open("one", next.context), "awaiting-trust");
    f.grant();
    const trusted = await f.acquire();
    await f.open("one", trusted.context);
    await f.ready("one", trusted.context);
    f.revoke();
    await rejects(f.broker.request("one", hover(trusted.context, f.uri)), "stale-generation");
  } finally {
    await f.dispose();
  }
});

async function rejects(operation: Promise<unknown>, reason: string) {
  const outcome = await operation.then(
    () => "resolved",
    (error: LanguageError) => Schema.decodeUnknownSync(LanguageError)(error).reason
  );

  expect(outcome).toBe(reason);
}

test("one Client uses separate processes and drafts for Workspace and Worktree", async () => {
  const f = await fixture();

  try {
    const workspace = await f.acquire();
    const worktreeUri = new URL("file.ts", new URL(`file://${f.worktreeRoot}/`)).href;

    const worktree = await f.broker.acquire("one", {
      clientId: "one",
      contextId: "worktree",
      interestId: "file",
      checkout: f.worktree,
      path: `${f.worktreeRoot}/file.ts`,
      providerId: "fake",
      settings: f.settings,
    });

    await f.open("one", workspace.context, "workspace draft");
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context: worktree.context,
        sequence: 1,
        notification: LanguageDocumentNotification.cases.Open.make({
          uri: worktreeUri,
          languageId: "typescript",
          version: 1,
          text: "worktree draft",
        }),
      })
    );
    await Promise.all([f.ready("one", workspace.context), f.ready("one", worktree.context)]);
    expect((await f.broker.request("one", hover(workspace.context, f.uri))).result).toHaveProperty(
      "text",
      "workspace draft"
    );
    expect(
      (await f.broker.request("one", hover(worktree.context, worktreeUri))).result
    ).toHaveProperty("text", "worktree draft");
    expect(f.processes).toHaveLength(2);
  } finally {
    await f.dispose();
  }
});

test("crashes require new snapshots, retry budget stops and manual restart resets", async () => {
  const f = await fixture("crash-open");

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { context } = await f.acquire();

      const iterator = f.broker
        .watch("one", context, AbortSignal.timeout(1500))
        [Symbol.asyncIterator]();

      await f.open("one", context);
      await awaitFailure(iterator, attempt);
      await iterator.return?.();
      await Bun.sleep(40);
    }

    const exhausted = await f.acquire();
    await f.open("one", exhausted.context);
    await Bun.sleep(40);
    expect(f.processes).toHaveLength(3);
    const restart = await f.broker.restart("one", exhausted.context);
    expect(restart.ack.documents).toHaveLength(0);
    await f.open("one", restart.context);

    for (let i = 0; i < 200 && f.processes.length < 4; i++) await Bun.sleep(5);
    expect(f.processes).toHaveLength(4);
  } finally {
    await f.dispose();
  }

  expect(f.broker.stats().cleanup).toBe(0);
}, 10000);

test("malformed actual server output invalidates generation and cleans child", async () => {
  const f = await fixture("malformed");

  try {
    const original = await f.acquire();
    await f.open("one", original.context);
    let current = await f.acquire();

    for (let i = 0; i < 200 && current.context.generation === original.context.generation; i++) {
      await Bun.sleep(5);
      current = await f.acquire();
    }

    expect(current.context.generation).toBeGreaterThan(original.context.generation);
    expect(current.ack.documents).toHaveLength(0);
    expect(f.broker.stats().processes).toBe(0);
  } finally {
    await f.dispose();
  }
});

async function awaitFailure(iterator: AsyncIterator<LanguageContextEvent>, attempt: number) {
  let failed = false;

  while (!failed) {
    const event = await iterator.next();

    if (event.done) throw new Error("Missing crash event");

    if (
      Schema.is(LanguageContextEvent.cases.RuntimeChanged)(event.value) &&
      Schema.is(LanguageRuntime.cases.Failed)(event.value.runtime)
    ) {
      expect(event.value.runtime.attempts).toBe(attempt);

      if (attempt === 3) expect(event.value.runtime.retryAt).toBeNull();
      failed = true;
    }
  }
}

test("grace cleanup cannot wait for another Client or delete a newly acquired context", async () => {
  const f = await fixture("slow-shutdown");

  try {
    const first = await f.acquire("one");
    const second = await f.acquire("two");
    await f.open("one", first.context);
    await f.open("two", second.context, "other Client");
    await f.ready("one", first.context);
    await f.ready("two", second.context);
    await f.broker.release("one", first.context, "file");
    await f.broker.sync(
      "one",
      LanguageSyncInput.make({
        context: first.context,
        sequence: 2,
        notification: LanguageDocumentNotification.cases.Close.make({ uri: f.uri, version: 1 }),
      })
    );

    for (let i = 0; i < 100 && f.broker.stats().contexts === 2; i++) await Bun.sleep(5);
    expect(f.broker.stats().contexts).toBe(1);
    const replacement = await f.acquire("one");
    expect(replacement.context.generation).toBeGreaterThan(first.context.generation);
    await f.open("one", replacement.context, "replacement");
    await f.ready("one", replacement.context);
    expect(await f.processes[0]!.exited).toBe(0);
    expect(f.broker.snapshot("one", replacement.context).ack.documents).toHaveLength(1);
    expect((await f.broker.request("two", hover(second.context, f.uri))).result).toHaveProperty(
      "text",
      "other Client"
    );
  } finally {
    await f.dispose();
  }
});

test("disconnect fences in-flight discovery without cancelling another Client", async () => {
  let release: (() => void) | undefined;

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const f = await fixture("ordinary", 10, undefined, gate);

  try {
    const lost = rejects(f.acquire("one"), "not-connected");
    const other = f.acquire("two");
    f.broker.disconnect("one");
    release?.();
    await lost;
    expect((await other).context.clientId).toBe("two");
    expect(f.broker.stats().contexts).toBe(1);
    expect(f.broker.stats().acquiring).toBe(0);
  } finally {
    release?.();
    await f.dispose();
  }
});

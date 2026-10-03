import { expect, test } from "bun:test";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { withFileMutation } from "../../files/write.ts";
import { resourceFixture } from "./resourceEdits.testing.ts";

const rejects = async <A>(promise: Promise<A>) => {
  expect(
    await promise.then(
      () => false,
      () => true
    )
  ).toBe(true);
};

const using = (run: (f: Awaited<ReturnType<typeof resourceFixture>>) => Promise<void>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* EventStore;
        yield* Effect.promise(async () => {
          const f = await resourceFixture(store);

          try {
            await run(f);
          } finally {
            await f.cleanup();
          }
        });
      })
    ).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );

test("authenticated format-2 acceptance, durable status, identical retry and revision-guarded undo", () =>
  using(async (f) => {
    const decision = { acceptance: f.acceptance, drafts: f.drafts };
    const result = await f.run(f.handlers.treeDecide(decision));
    expect(result.state).toBe("applied");
    expect(result.format).toBe(2);
    expect(f.verifyCount()).toBeGreaterThan(3);
    const status = await f.run(f.handlers.treeGet(f.status));
    expect(status).toEqual(result);
    const count = f.verifyCount();
    expect(await f.run(f.handlers.treeDecide(decision))).toEqual(result);
    expect(f.verifyCount()).toBe(count);
    await rejects(
      f.run(
        f.handlers.treeRecover({
          ...f.status,
          intent: "undo",
          expectedReceiptRevision: result.receiptRevision,
        })
      )
    );
    f.reconciled(result.receiptRevision);
    await rejects(
      f.run(
        f.handlers.treeRecover({
          ...f.status,
          intent: "undo",
          expectedReceiptRevision: result.receiptRevision - 1,
        })
      )
    );
    expect(
      (
        await f.run(
          f.handlers.treeRecover({
            ...f.status,
            intent: "undo",
            expectedReceiptRevision: result.receiptRevision,
          })
        )
      ).state
    ).toBe("restored");
    expect(await readFile(join(f.root, "source", "nested", "file"), "utf8")).toBe("alpha\r\n");
  }));

test("unknown status remains unknown and cannot replay recovery", () =>
  using(async (f) => {
    await rejects(f.run(f.handlers.treeGet(f.status)));
    await rejects(
      f.run(f.handlers.treeRecover({ ...f.status, intent: "recover", expectedReceiptRevision: 0 }))
    );
    await access(join(f.root, "source"));
  }));

test("replaced authenticated principal during private receipt read fails before mutation", () =>
  using(async (f) => {
    f.onVerify(async () => {
      f.replace();
    });
    await rejects(f.run(f.handlers.treeDecide({ acceptance: f.acceptance, drafts: f.drafts })));
    await access(join(f.root, "source"));
    expect(await readFile(join(f.root, "target", "original"), "utf8")).toBe("overwritten");
  }));

test("revoked proposal after checkout lock wait fails before mutation", () =>
  using(async (f) => {
    let release = () => {};

    let entered = () => {};

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const held = withFileMutation(f.root, async () => {
      entered();
      await gate;
    });

    await ready;
    let verified = () => {};

    const checked = new Promise<void>((resolve) => {
      verified = resolve;
    });

    f.onVerify(async () => {
      verified();
    });
    const pending = f.run(f.handlers.treeDecide({ acceptance: f.acceptance, drafts: f.drafts }));

    try {
      await checked;
      f.revoke();
      release();
      await rejects(pending);
      await access(join(f.root, "source"));
    } finally {
      release();
      await held;
    }
  }));

test("forged preview and intervening descendant write preserve newer content", () =>
  using(async (f) => {
    const request = await f.request(
      [{ kind: "rename", oldUri: f.uri("source"), newUri: f.uri("final") }],
      ["source", "final"]
    );
    // This fixture's recorded proposal differs; forged acceptance must fail before native mutation.

    await rejects(
      f.run(f.handlers.treeDecide({ acceptance: request.acceptance, drafts: request.drafts }))
    );
    await writeFile(join(f.root, "source", "nested", "file"), "newer");
    expect(
      (await f.run(f.handlers.treeDecide({ acceptance: f.acceptance, drafts: f.drafts }))).state
    ).toBe("failed");
    expect(await readFile(join(f.root, "source", "nested", "file"), "utf8")).toBe("newer");
  }));

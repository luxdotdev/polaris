import { describe, expect, test } from "bun:test";
import type { DraftGroup } from "./group.ts";
import { intervene } from "./drafts.ts";
import { expired, needsUser } from "./lifetime.ts";
import { memoryGroups } from "./storage.ts";
import { doc, fixture, proposal } from "./testing.ts";
import { previewFingerprint } from "./group.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { RefactorController } from "./controller.ts";

const EARLIER = 1;

const group = (
  state: DraftGroup["state"],
  touched: readonly string[],
  patch: Partial<DraftGroup> = {}
): DraftGroup => ({
  format: 2,
  id: `group-${state}-${touched.length}`,
  operationId: "operation",
  hostKey: "local",
  revision: 0,
  updatedAt: Date.now(),
  fingerprint: "f".repeat(64),
  proposal: proposal(),
  originals: touched.map((path) => doc(path, "before", false)),
  documents: touched.map((path) => doc(path, "after", false)),
  touched,
  state,
  outcome: null,
  message: "",
  ...patch,
});

const ONE = ["/checkout/a"];

const MANY = ["/checkout/a", "/checkout/b"];

describe("recovery shows only for an unresolved multi-file outcome", () => {
  test.each([
    ["unknown", MANY, true],
    ["partial", MANY, true],
    ["unknown", ONE, false],
    ["partial", ONE, false],
    ["conflict", MANY, false],
    ["conflict", ONE, false],
    ["applied", MANY, false],
    ["restored", MANY, false],
    ["prepared", MANY, false],
  ] as const)("%s across %p files: %p", (state, touched, shown) => {
    expect(needsUser(group(state, touched))).toBe(shown);
  });
});

describe("stored groups expire", () => {
  test("an outcome whose coordinated undo is gone expires at once", () => {
    expect(expired(group("conflict", MANY))).toBe(true);
    expect(expired(group("restored", MANY))).toBe(true);
  });

  test("a completed or one-file change from an earlier launch is purged on load", () => {
    expect(expired(group("applied", ONE, { updatedAt: EARLIER }))).toBe(true);
    expect(expired(group("applied", MANY, { updatedAt: EARLIER }))).toBe(true);
    expect(expired(group("unknown", ONE, { updatedAt: EARLIER }))).toBe(true);
    expect(expired(group("prepared", ONE, { updatedAt: EARLIER }))).toBe(true);
  });

  test("this launch's applied change stays for ⌘Z; an unresolved multi-file one stays", () => {
    expect(expired(group("applied", ONE))).toBe(false);
    expect(expired(group("unknown", MANY, { updatedAt: EARLIER }))).toBe(false);
    expect(expired(group("partial", MANY, { updatedAt: EARLIER }))).toBe(false);
  });

  test("a group still holding unsaved drafts never expires", () => {
    const dirty = MANY.map((path) => doc(path, "unsaved", true));

    expect(expired(group("conflict", MANY, { documents: dirty }))).toBe(false);
  });
});

describe("saving a file a refactor touched", () => {
  test("the owner's case: a one-file rename, then a save, leaves no record", async () => {
    const store = memoryGroups();

    await store.commit(group("applied", ONE), null);
    await intervene(store, "local", "/checkout/a", doc("/checkout/a", "saved", false));

    expect(await store.list()).toEqual([]);
  });

  test("a partial multi-file outcome stays partial and keeps surfacing", async () => {
    const store = memoryGroups();

    await store.commit(group("partial", MANY), null);
    await intervene(store, "local", "/checkout/a", doc("/checkout/a", "saved", false));

    const [kept] = await store.list();

    expect(kept?.state).toBe("partial");
    expect(kept !== undefined && needsUser(kept)).toBe(true);
  });

  test("an applied multi-file change with another file's unsaved draft stays, silently", async () => {
    const store = memoryGroups();

    const documents = [doc("/checkout/a", "after", false), doc("/checkout/b", "unsaved", true)];

    await store.commit(group("applied", MANY, { documents }), null);
    await intervene(store, "local", "/checkout/a", doc("/checkout/a", "saved", false));

    const [kept] = await store.list();

    expect(kept?.state).toBe("conflict");
    expect(kept !== undefined && needsUser(kept)).toBe(false);
  });
});

test("loading purges stale records and surfaces only the unresolved multi-file one", async () => {
  const store = memoryGroups();
  const shared = proposal();
  const fingerprint = await previewFingerprint(shared);

  const stale = [
    group("conflict", ONE, { id: "renamed-then-saved", fingerprint, proposal: shared }),
    group("applied", ONE, {
      id: "last-launch-rename",
      fingerprint,
      proposal: shared,
      updatedAt: EARLIER,
    }),
    group("unknown", ONE, {
      id: "one-file-unknown",
      fingerprint,
      proposal: shared,
      updatedAt: EARLIER,
    }),
  ];

  const unresolved = group("partial", MANY, {
    id: "half-moved",
    fingerprint,
    proposal: shared,
    updatedAt: EARLIER,
  });

  for (const value of [...stale, unresolved]) await store.commit(value, null);

  const controller = new RefactorController(
    "local",
    new RefactorCoordinator(store, fixture().port, "utf-16")
  );

  await controller.restore();

  expect((await store.list()).map((value) => value.id)).toEqual(["half-moved"]);
  expect(controller.state.getState().group?.id).toBe("half-moved");
});

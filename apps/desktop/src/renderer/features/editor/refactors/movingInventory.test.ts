import { test, expect } from "bun:test";
import { doc, fixture } from "./testing.ts";
import { memoryGroups } from "./storage.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { checkMovingDraftOwnership } from "./movingInventory.ts";
import { createDraftStore } from "../model/draftStore.ts";
import { memoryKeyValue, writeDraft } from "../model/drafts.ts";

const prepared = async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  return { ...group, state: "prepared" as const, revision: 0, outcome: null };
};

test("moving ownership tolerates Host disk movement but rejects same-text revisions and newly affected dirty buffers", async () => {
  const group = await prepared();
  const store = memoryGroups();
  await store.commit(group, null);

  const drafts = createDraftStore(null, null);
  await checkMovingDraftOwnership(
    group,
    [{ ...doc(), diskVersion: null, diskText: null }],
    null,
    drafts,
    store
  );
  await Promise.resolve(
    expect(
      checkMovingDraftOwnership(
        group,
        [{ ...doc(), version: 4, draftRevision: 6 }],
        null,
        drafts,
        store
      )
    ).rejects.toThrow("revisions changed")
  );
  expect((await store.get(group.id))?.originals).toEqual(group.originals);
});

test("moving ownership checks actual closed legacy text and revision, never Host disk snapshots", async () => {
  const group = await prepared();
  const closed = { ...group.originals[0]!, buffer: null, version: 0, draftRevision: 5 };
  const next = { ...group, originals: [closed], documents: [closed] };
  const store = memoryGroups();
  await store.commit(next, null);
  const kv = memoryKeyValue();
  writeDraft(
    kv,
    { hostKey: "host", path: closed.canonicalPath, text: closed.text, base: closed.diskVersion },
    5
  );
  const drafts = createDraftStore(kv, null);
  await checkMovingDraftOwnership(next, [], kv, drafts, store);
  writeDraft(
    kv,
    { hostKey: "host", path: closed.canonicalPath, text: closed.text, base: closed.diskVersion },
    6
  );
  await Promise.resolve(
    expect(checkMovingDraftOwnership(next, [], kv, drafts, store)).rejects.toThrow(
      "revisions changed"
    )
  );
});

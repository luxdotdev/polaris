import { test, expect } from "bun:test";
import { FileVersion, LanguageTreeEditProposal } from "@polaris/protocol";
import { strict as assert } from "node:assert";
import { RefactorCoordinator } from "./coordinator.ts";
import { validateInventory } from "./plan.ts";
import { memoryGroups } from "./storage.ts";
import { doc, fixture, proposal } from "./testing.ts";

const cleanFixture = () => {
  const document = doc("/checkout/a", "base", false);
  const original = proposal(document);

  const prepared = LanguageTreeEditProposal.make({
    ...original,
    fence: { ...original.fence, documents: [] },
    snapshots: original.snapshots.map((snapshot) => ({ ...snapshot, buffer: null })),
  });

  return { document, prepared };
};

test("a clean open view outside the provider fence matches the exact Host disk snapshot", async () => {
  const { document, prepared } = cleanFixture();
  expect(() => validateInventory(prepared, [document])).not.toThrow();
  const f = fixture();
  f.setInventory([document]);
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");
  const preview = await coordinator.preview(prepared);
  expect(preview.originals[0]?.buffer).toEqual(document.buffer);
  const accepted = await coordinator.accept(preview, "group", "operation", "host");
  expect(accepted.state).toBe("applied");
  expect(accepted.originals[0]?.draftRevision).toBe(document.draftRevision);
});

test("unacknowledged dirty text and changed disk facts still refuse a preview", () => {
  const { document, prepared } = cleanFixture();
  const changedText = "changed";

  for (const changed of [
    { ...document, dirty: true },
    { ...document, text: changedText, buffer: { ...document.buffer!, text: changedText } },
    { ...document, diskText: "changed" },
    { ...document, diskVersion: FileVersion.make({ mtimeMs: 2, size: 4, hash: "b".repeat(64) }) },
    { ...document, diskVersion: FileVersion.make({ mtimeMs: 1, size: 4, hash: "c".repeat(64) }) },
  ])
    expect(() => validateInventory(prepared, [changed])).toThrow("Text snapshot changed");
});

test("a synchronized document requires its actual acknowledged tuple", () => {
  const { document, prepared } = cleanFixture();

  const fenced = LanguageTreeEditProposal.make({
    ...prepared,
    fence: { ...prepared.fence, documents: [{ uri: document.uri, version: document.version }] },
  });

  expect(() => validateInventory(fenced, [document])).toThrow("Text snapshot changed");
  const acknowledged = proposal(document);

  const next = {
    ...document,
    version: document.version + 1,
    buffer: { ...document.buffer!, version: document.version + 1 },
  };

  expect(() => validateInventory(acknowledged, [next])).toThrow("Text snapshot changed");
});

test("same-text local revision changes after preview refuse before persistence or Host mutation", async () => {
  const { document, prepared } = cleanFixture();
  const f = fixture();
  f.setInventory([document]);
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");
  const preview = await coordinator.preview(prepared);
  f.setInventory([
    {
      ...document,
      draftRevision: document.draftRevision + 1,
      buffer: { ...document.buffer!, draftRevision: document.draftRevision + 1 },
    },
  ]);
  await assert.rejects(coordinator.accept(preview, "group", "operation", "host"), /Drafts changed/);
  expect(await store.list()).toEqual([]);
  expect(f.calls).toEqual([]);
});

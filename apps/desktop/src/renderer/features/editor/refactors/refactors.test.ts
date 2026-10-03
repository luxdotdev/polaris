import { LanguageTreeManifest, LanguageTreeEditProposal } from "@polaris/protocol";
import { Schema } from "effect";
import { test, expect } from "bun:test";
import { RefactorCoordinator } from "./coordinator.ts";
import { RefactorController, bindRefactors, refactorRegistry } from "./controller.ts";
import { memoryGroups } from "./storage.ts";
import { draftReceipt, previewFingerprint } from "./group.ts";
import { doc, fixture, proposal } from "./testing.ts";
import { promoteTextProposal } from "./proposals.ts";
import { resourceFixture } from "./resources.testing.ts";
import { project, filePath, fileUri, validateInventory } from "./plan.ts";
import { projectedDraft, projectedState } from "./drafts.ts";
import { collectInventory } from "./inventory.ts";
import { memoryKeyValue, writeDraft } from "../model/drafts.ts";
import { createDraftStore } from "../model/draftStore.ts";
import type { EditorFiles } from "../files/port.ts";

test("server applyEdit offers only; explicit accept persists drafts and guarded undo restores original", async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");
  const controller = new RefactorController("host", coordinator);
  await controller.offer(f.proposal);
  expect(f.calls).toEqual([]);
  await controller.accept();
  const group = controller.state.getState().group!;
  expect(group.state).toBe("applied");
  expect(group.originals[0]?.text).toBe("a😀b\r\n");
  expect(group.documents[0]?.text).toBe("aλb\r\n");
  expect((await projectedDraft(store, "host", "/checkout/a", null))?.text).toBe("aλb\r\n");
  await controller.recover("undo");
  expect(controller.state.getState().group?.documents[0]?.text).toBe("a😀b\r\n");
  expect(f.calls).toEqual(["accept", "publish:applied", "undo", "publish:restored"]);
});

test("stale dirty inventory refuses before any group or Host mutation", async () => {
  const f = fixture();
  const store = memoryGroups();
  const c = new RefactorCoordinator(store, f.port, "utf-16");
  const p = await c.preview(f.proposal);
  f.setInventory([doc("/checkout/a", "new user text")]);
  await failure(c.accept(p, "group", "operation", "host"), "Drafts changed");
  expect(await store.list()).toEqual([]);
  expect(f.calls).toEqual([]);
});

test("lost Host response persists unknown; status never replays accept", async () => {
  const f = fixture();
  const store = memoryGroups();

  const port = {
    ...f.port,
    decide: async () => {
      f.calls.push("lost");
      throw new Error("Disconnected");
    },
  };

  const c = new RefactorCoordinator(store, port, "utf-16");
  const p = await c.preview(f.proposal);
  const group = await c.accept(p, "group", "operation", "host");
  expect(group.state).toBe("unknown");
  expect(group.documents).toEqual(group.originals);
  await failure(c.status("group"), "No durable Host receipt");
  expect(f.calls).toEqual(["lost", "publish:unknown", "get"]);
  await failure(
    c.verifyReceipt(f.proposal.fence.context, f.proposal, draftReceipt(group), "operation"),
    "does not own"
  );
});

test("quota/abort rejects before Host; rejection creates no group", async () => {
  const f = fixture();
  const store = memoryGroups();

  const c = new RefactorCoordinator(
    {
      ...store,
      commit: async () => {
        throw new Error("QuotaExceededError");
      },
    },
    f.port,
    "utf-16"
  );

  await failure(
    c.accept(await c.preview(f.proposal), "group", "operation", "host"),
    "QuotaExceededError"
  );
  expect(f.calls).toEqual([]);
  await c.reject(await c.preview(f.proposal), "reject");
  expect(await store.list()).toEqual([]);
  expect(f.calls).toEqual(["reject"]);
});

test("persisted receipt verifies current independent owner, full preview and complete dirty inventory", async () => {
  const f = fixture();
  const store = memoryGroups();
  const c = new RefactorCoordinator(store, f.port, "utf-16");
  const p = await c.preview(f.proposal);
  await store.commit(
    {
      format: 2,
      id: "group",
      operationId: "operation",
      hostKey: "host",
      revision: 0,
      updatedAt: Date.now(),
      fingerprint: await previewFingerprint(f.proposal),
      proposal: f.proposal,
      originals: p.originals,
      documents: p.originals,
      touched: p.touched,
      state: "prepared",
      outcome: null,
      message: "",
    },
    null
  );
  const group = (await store.get("group"))!;
  const receipt = draftReceipt(group);
  await c.verifyReceipt(f.proposal.fence.context, f.proposal, receipt, "operation");
  await failure(
    c.verifyReceipt(
      { ...f.proposal.fence.context, clientId: "other" },
      f.proposal,
      receipt,
      "operation"
    ),
    "does not own"
  );
  f.setInventory([doc("/checkout/a", "newer")]);
  await failure(
    c.verifyReceipt(f.proposal.fence.context, f.proposal, receipt, "operation"),
    "incomplete"
  );
});

test("ordered rename/overwrite keeps both dirty originals and moves source text before edits", () => {
  const source = doc("/checkout/source/a", "alpha");
  const overwritten = doc("/checkout/target/a", "precious");

  const tree = Schema.decodeUnknownSync(LanguageTreeManifest)({
    format: 1,
    entries: [
      {
        relativePath: "",
        kind: "directory",
        identity: { device: 1, inode: 1, mode: 448 },
        version: null,
      },
      {
        relativePath: "a",
        kind: "file",
        identity: { device: 1, inode: 2, mode: 384 },
        version: source.diskVersion,
      },
    ],
  });

  const p = {
    ...proposal(source),
    snapshots: [],
    resourceSnapshots: ["source", "target"].map((name) => ({
      uri: "file:///checkout/" + name,
      canonicalPath: "/checkout/" + name,
      tree,
    })),
    edit: {
      documentChanges: [
        {
          kind: "rename" as const,
          oldUri: "file:///checkout/source",
          newUri: "file:///checkout/target",
          options: { overwrite: true },
        },
        {
          textDocument: { uri: "file:///checkout/target/a", version: source.version },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
              newText: "beta",
            },
          ],
        },
      ],
    },
  };

  const projected = project(p, [source, overwritten], "utf-16");
  expect(projected.documents.map((value) => [value.canonicalPath, value.text])).toEqual([
    ["/checkout/target/a", "beta"],
  ]);
  expect(source.text).toBe("alpha");
  expect(overwritten.text).toBe("precious");
});

test("Unicode boundaries, overlap, escapes and ambiguous forms fail closed", () => {
  expect(() => filePath("file:///outside/a", "/checkout")).toThrow("leaves");
  expect(() => filePath("file:///checkout/a%2fb", "/checkout")).toThrow("canonical");
  const d = doc();
  const p = proposal(d);
  const edit = p.edit.changes![d.uri]![0]!;
  expect(() =>
    project(
      {
        ...p,
        edit: {
          changes: {
            [d.uri]: [
              {
                ...edit,
                range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
              },
            ],
          },
        },
      },
      [d],
      "utf-16"
    )
  ).toThrow("boundary");
  expect(() =>
    project({ ...p, edit: { changes: { [d.uri]: [edit, edit] } } }, [d], "utf-16")
  ).toThrow("Overlapping");

  const utf8 = {
    ...edit,
    range: { start: { line: 0, character: 1 }, end: { line: 0, character: 5 } },
  };

  expect(
    project({ ...p, edit: { changes: { [d.uri]: [utf8] } } }, [d], "utf-8").documents[0]?.text
  ).toBe("aλb\r\n");
});

const failure = async (promise: Promise<unknown>, message: string) => {
  let cause: unknown;

  try {
    await promise;
  } catch (error) {
    cause = error;
  }

  expect(cause).toBeInstanceOf(Error);
  expect(String(cause)).toContain(message);
};

test("stale Host receipt CAS and changed buffers prevent undo without any reverse mutation", async () => {
  const f = fixture();
  const store = memoryGroups();
  let newer = false;

  const c = new RefactorCoordinator(
    store,
    {
      ...f.port,
      current: async () => {
        if (newer) throw new Error("Newer user edit");
      },
    },
    "utf-16"
  );

  const group = await c.accept(await c.preview(f.proposal), "group", "operation", "host");
  newer = true;
  await failure(c.recover(group.id, "undo"), "Newer user edit");
  expect(f.calls).toEqual(["accept", "publish:applied"]);
  expect((await store.get(group.id))?.documents[0]?.text).toBe("aλb\r\n");
});

test("disconnected or expired preview refuses before persistence", async () => {
  const f = fixture();
  const store = memoryGroups();
  const c = new RefactorCoordinator(store, f.port, "utf-16");
  const p = await c.preview(f.proposal);
  await failure(
    c.accept({ ...p, proposal: { ...p.proposal, expiresAt: 0 } }, "group", "operation", "host"),
    "expired"
  );
  f.disconnect();
  await failure(c.accept(p, "group", "operation", "host"), "Connect");
  expect(await store.list()).toEqual([]);
});

test("storage revision CAS refuses stale competing group and preserves prior originals", async () => {
  const f = fixture();
  const store = memoryGroups();
  const c = new RefactorCoordinator(store, f.port, "utf-16");
  const group = await c.accept(await c.preview(f.proposal), "group", "operation", "host");
  await failure(
    store.commit({ ...group, revision: group.revision + 1 }, group.revision - 1),
    "revision changed"
  );
  expect((await store.get(group.id))?.originals[0]?.text).toBe("a😀b\r\n");
});

test("changed full fingerprint and resource manifests cannot reuse a persisted group", async () => {
  const f = fixture();
  const c = new RefactorCoordinator(memoryGroups(), f.port, "utf-16");
  const preview = await c.preview(f.proposal);
  await failure(
    c.accept(
      { ...preview, proposal: { ...preview.proposal, label: "different" } },
      "group",
      "operation",
      "host"
    ),
    "Preview changed"
  );
  expect(f.calls).toEqual([]);
});

test("single user code action can apply directly; a single server request still requires explicit acceptance", async () => {
  const f = fixture();

  const controller = new RefactorController(
    "host",
    new RefactorCoordinator(memoryGroups(), f.port, "utf-16")
  );

  await controller.applyAction({ ...f.proposal, origin: "code-action" });
  expect(f.calls[0]).toBe("accept");
  expect(controller.state.getState().preview).toBeNull();
  const server = fixture();

  const other = new RefactorController(
    "host",
    new RefactorCoordinator(memoryGroups(), server.port, "utf-16")
  );

  await other.applyAction(server.proposal);
  expect(server.calls).toEqual([]);
  expect(other.state.getState().hostKey).toBe("host");
});

test("post-transaction fence failure creates no Host request and keeps original drafts", async () => {
  const f = fixture();
  let validations = 0;
  const store = memoryGroups();

  const c = new RefactorCoordinator(
    store,
    {
      ...f.port,
      validate: async () => {
        validations++;

        if (validations === 3) throw new Error("Stale generation after transaction");
      },
    },
    "utf-16"
  );

  const preview = await c.preview(f.proposal);
  await failure(c.accept(preview, "group", "operation", "host"), "Stale generation");
  expect(f.calls).toEqual([]);
  expect((await store.get("group"))?.originals[0]?.text).toBe("a😀b\r\n");
});

test("restart recovery uses persisted receipt revision instead of resetting the fake Host CAS", async () => {
  const first = fixture();
  const store = memoryGroups();
  const original = new RefactorCoordinator(store, first.port, "utf-16");

  const group = await original.accept(
    await original.preview(first.proposal),
    "group",
    "operation",
    "host"
  );

  const restarted = new RefactorCoordinator(store, fixture().port, "utf-16");
  const restored = await restarted.recover(group.id, "undo");
  expect(restored.outcome?.receiptRevision).toBe(group.outcome!.receiptRevision + 1);
  expect(restored.documents[0]?.text).toBe(group.originals[0]?.text);
});

test("stale and nonincrementing Host receipts remain rejected after recovery", async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  await coordinator.recover(group.id, "undo");
  await failure(coordinator.status(group.id), "stale");
  const restored = (await store.get(group.id))!;
  expect(restored.state).toBe("restored");
  expect(restored.originals[0]?.text).toBe("a😀b\r\n");
});

test("restart recovery card excludes another independently authenticated checkout", async () => {
  const f = fixture();
  const store = memoryGroups();
  const coordinator = new RefactorCoordinator(store, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const contexts = [
    { ...group.proposal.fence.context, clientId: "foreign-client" },
    { ...group.proposal.fence.context, generation: 2 },
    {
      ...group.proposal.fence.context,
      checkout: { ...group.proposal.fence.context.checkout, path: "/another-checkout" },
    },
  ];

  for (const [index, context] of contexts.entries())
    await store.commit(
      {
        ...group,
        id: "foreign-" + index,
        revision: 0,
        updatedAt: group.updatedAt + index + 1,
        proposal: { ...group.proposal, fence: { ...group.proposal.fence, context } },
      },
      null
    );

  const controller = new RefactorController("host", coordinator);
  await controller.restore();
  expect(controller.state.getState().group?.id).toBe("group");
});

test("partial ordered resources preserve overwritten/deleted originals and recover only confirmed prefix", async () => {
  const f = resourceFixture();
  const store = memoryGroups();
  const c = new RefactorCoordinator(store, f.port, "utf-16");
  const preview = await c.preview(f.proposal);
  const group = await c.accept(preview, "resources", "resources-op", "host");
  expect(group.state).toBe("partial");
  expect(group.documents.map((d) => d.canonicalPath)).toEqual([
    "/checkout/victim/a",
    "/checkout/created",
    "/checkout/target/a",
  ]);
  expect(group.originals.map((d) => d.text)).toEqual([
    "source unsaved",
    "overwritten unsaved",
    "deleted unsaved",
  ]);
  expect(draftReceipt(group).descendants).toHaveLength(3);
  const restored = await c.recover(group.id, "recover");
  expect(restored.documents.map((d) => d.text)).toEqual(group.originals.map((d) => d.text));
  expect(restored.outcome?.steps.map((s) => s.state)).toEqual([
    "restored",
    "restored",
    "not-applied",
  ]);
  expect(f.calls).toEqual(["accept", "recover"]);
});

test("late authenticated generation change clears recovery cards before exposure", async () => {
  const f = fixture();
  const store = memoryGroups();
  const original = new RefactorCoordinator(store, f.port, "utf-16");
  await original.accept(await original.preview(f.proposal), "group", "operation", "host");
  let reads = 0;

  const coordinator = new RefactorCoordinator(
    store,
    {
      ...f.port,
      authority: async () => ({ ...f.proposal.fence.context, generation: reads++ === 0 ? 1 : 2 }),
    },
    "utf-16"
  );

  const controller = new RefactorController("host", coordinator);
  await failure(controller.restore(), "context changed");
  expect(controller.state.getState().group).toBeNull();
});

test("newer closed legacy draft supersedes older grouped inventory before subsequent acceptance", async () => {
  const f = fixture();
  const groups = memoryGroups();
  const coordinator = new RefactorCoordinator(groups, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const kv = memoryKeyValue();
  writeDraft(
    kv,
    { hostKey: "host", path: "/checkout/a", text: "newer closed work", base: doc().diskVersion },
    group.updatedAt + 1
  );
  const draftStore = createDraftStore(kv, null);

  const files: EditorFiles = {
    read: () => Promise.resolve({ kind: "text", text: "base", version: doc().diskVersion! }),
    write: () => Promise.reject(new Error("Unexpected save")),
    watch: () => () => {},
  };

  const next = await collectInventory(f.proposal, "host", [], kv, draftStore, files, groups);
  expect(next[0]?.text).toBe("newer closed work");
  expect(() => validateInventory(f.proposal, next)).toThrow("Text snapshot changed");
  writeDraft(
    kv,
    {
      hostKey: "host",
      path: "/checkout/a",
      text: "equal ambiguous revision",
      base: doc().diskVersion,
    },
    group.updatedAt
  );
  await failure(
    collectInventory(f.proposal, "host", [], kv, draftStore, files, groups),
    "Ambiguous closed draft revision"
  );
  expect(
    (
      await projectedDraft(
        groups,
        "host",
        "/checkout/a",
        await draftStore.read("host", "/checkout/a")
      )
    )?.text
  ).toBe("equal ambiguous revision");
  writeDraft(
    kv,
    {
      hostKey: "host",
      path: "/checkout/a",
      text: "before asynchronous read",
      base: doc().diskVersion,
    },
    group.updatedAt + 3
  );
  await failure(
    collectInventory(
      f.proposal,
      "host",
      [],
      kv,
      draftStore,
      {
        ...files,
        read: async () => {
          writeDraft(
            kv,
            {
              hostKey: "host",
              path: "/checkout/a",
              text: "during asynchronous read",
              base: doc().diskVersion,
            },
            group.updatedAt + 4
          );

          return { kind: "text", text: "base", version: doc().diskVersion! };
        },
      },
      groups
    ),
    "changed while reading inventory"
  );

  writeDraft(
    kv,
    { hostKey: "host", path: "/checkout/a", text: "", base: doc().diskVersion, spilled: true },
    group.updatedAt + 2
  );
  await failure(
    collectInventory(f.proposal, "host", [], kv, draftStore, files, groups),
    "could not be read"
  );
  const opened = doc("/checkout/a", "live unsaved buffer");
  const live = await collectInventory(f.proposal, "host", [opened], kv, draftStore, files, groups);
  expect(live[0]?.text).toBe("live unsaved buffer");
});

test("new closed work during durable transaction refuses receipt before Host acceptance", async () => {
  const f = fixture();
  const store = memoryGroups();

  const c = new RefactorCoordinator(
    {
      ...store,
      commit: async (group, revision) => {
        await store.commit(group, revision);
        f.setInventory([doc("/checkout/a", "newer during transaction")]);
      },
    },
    f.port,
    "utf-16"
  );

  await failure(
    c.accept(await c.preview(f.proposal), "group", "operation", "host"),
    "Drafts changed"
  );
  expect(f.calls).toEqual([]);
  expect((await store.get("group"))?.originals[0]?.text).toBe("a😀b\r\n");
});

test("reopened group exposes persisted document revision and ownership independently of legacy drafts", async () => {
  const f = fixture();
  const groups = memoryGroups();
  const coordinator = new RefactorCoordinator(groups, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const state = await projectedState(groups, "host", "/checkout/a", null);
  expect(state.document?.version).toBe(group.documents[0]?.version);
  expect(state.draft?.text).toBe("aλb\r\n");

  const newer = {
    hostKey: "host",
    path: "/checkout/a",
    text: "newer",
    base: doc().diskVersion,
    savedAt: group.updatedAt,
  };

  expect((await projectedState(groups, "host", "/checkout/a", newer)).document).toBeNull();
});

test("registry snapshots expose controller replacement and old disposer cannot remove current preview", () => {
  const f = fixture();

  const first = new RefactorController(
    "registry-host",
    new RefactorCoordinator(memoryGroups(), f.port, "utf-16")
  );

  const second = new RefactorController(
    "registry-host",
    new RefactorCoordinator(memoryGroups(), f.port, "utf-16")
  );

  const key = "registry-host\u0000/registry-root";

  const selected = (state: { readonly controllers?: ReadonlyMap<string, RefactorController> }) =>
    state.controllers?.get(key);

  const before = refactorRegistry.getState();
  const disposeFirst = bindRefactors(first, "/registry-root");
  const firstSnapshot = refactorRegistry.getState();
  const disposeSecond = bindRefactors(second, "/registry-root");
  expect(selected(before)).toBeUndefined();
  expect(selected(firstSnapshot)).toBe(first);
  expect(selected(refactorRegistry.getState())).toBe(second);
  disposeFirst();
  expect(selected(refactorRegistry.getState())).toBe(second);
  disposeSecond();
  expect(selected(refactorRegistry.getState())).toBeUndefined();
});

test("text-only promotion preserves legacy proposal and cannot erase versioned resources", () => {
  const tree = proposal();
  const { format: _format, resourceSnapshots: _resources, ...legacy } = tree;
  expect(promoteTextProposal(legacy)).toEqual(tree);
  expect(() => promoteTextProposal(tree)).toThrow("dedicated tree decoder");
  expect(() =>
    promoteTextProposal({
      ...legacy,
      edit: { documentChanges: [{ kind: "delete", uri: "file:///checkout/a" }] },
    })
  ).toThrow("complete format-2");
});

test("private authenticated group status exposes bounded metadata without original texts or new acceptance", async () => {
  const f = fixture();
  const coordinator = new RefactorCoordinator(memoryGroups(), f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "group",
    "operation",
    "host"
  );

  const status = await coordinator.groupStatus(
    f.proposal.fence.context,
    group.id,
    group.operationId
  );

  expect(status.state).toBe("applied");
  expect(status.hostReceiptRevision).toBe(group.outcome?.receiptRevision ?? null);
  expect(JSON.stringify(status)).not.toContain("a😀b");
  await failure(
    coordinator.groupStatus(
      { ...f.proposal.fence.context, clientId: "intruder" },
      group.id,
      group.operationId
    ),
    "authenticated context"
  );
  await failure(
    coordinator.groupStatus(f.proposal.fence.context, group.id, "another-operation"),
    "does not own"
  );
  expect(f.calls.filter((call) => call === "accept")).toHaveLength(1);
});

test("current inventory preserves an absent initial text snapshot for ordered create then edit", async () => {
  const f = resourceFixture();

  const input = {
    ...f.proposal,
    snapshots: [
      {
        uri: "file:///checkout/created",
        canonicalPath: "/checkout/created",
        diskVersion: null,
        diskText: null,
        buffer: null,
      },
    ],
    edit: {
      documentChanges: [
        { kind: "create", uri: "file:///checkout/created" },
        {
          textDocument: { uri: "file:///checkout/created", version: null },
          edits: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
              newText: "created draft",
            },
          ],
        },
      ],
    },
  };

  const proposal = Schema.decodeUnknownSync(LanguageTreeEditProposal)(input);

  const files: EditorFiles = {
    read: () => Promise.resolve({ kind: "missing" }),
    write: () => Promise.reject(new Error("No implicit save")),
    watch: () => () => {},
  };

  const inventory = await collectInventory(
    proposal,
    "host",
    [],
    null,
    createDraftStore(null, null),
    files
  );

  validateInventory(proposal, inventory);
  const projected = project(proposal, inventory, "utf-16");
  expect(inventory[0]?.diskVersion).toBeNull();
  expect(projected.documents[0]?.text).toBe("created draft");
  expect(projected.documents[0]?.dirty).toBe(true);
});

test("canonical file URIs retain literal hash and query characters for inventory and projection", () => {
  const path = "/checkout/a#name?.ts";
  expect(filePath(fileUri(path), "/checkout")).toBe(path);
  expect(fileUri(path)).toBe("file:///checkout/a%23name%3F.ts");
});

import { resourceFixture } from "./resources.testing.ts";
import { RefactorController, bindRefactors } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { indexedDbGroups } from "./storage.ts";
import { collectInventory } from "./inventory.ts";
import { memoryKeyValue, writeDraft } from "../model/drafts.ts";
import { createDraftStore } from "../model/draftStore.ts";
import {
  configureEditor,
  ensureBuffer,
  whenLoaded,
  viewOf,
  resetBuffers,
  bufferOf,
} from "../runtime/buffers.ts";
import {
  checkRefactorBuffers,
  checkRefactorDrafts,
  openRefactorDocuments,
  publishRefactorBuffers,
} from "../runtime/refactorBuffers.ts";
import { fileKey } from "../model/drafts.ts";
import type { EditorFiles } from "../files/port.ts";
import type { DraftGroup } from "./group.ts";

const fixture = resourceFixture();

const store = indexedDbGroups();

const runtimeKv = memoryKeyValue();

const runtimeDrafts = createDraftStore(runtimeKv, null);

const runtimeFiles: EditorFiles = {
  read: () =>
    Promise.resolve({ kind: "text", text: "base", version: fixture.originals[0]!.diskVersion! }),
  write: () => Promise.reject(new Error("Resource drafts must not implicitly save")),
  watch: () => () => {},
};

configureEditor({
  files: runtimeFiles,
  kv: runtimeKv,
  groups: store,
  prefs: () => ({ vim: false, autosave: true }),
  canWrite: () => true,
  hostLabel: () => "fixture",
  hostHome: () => null,
});

const coordinator: RefactorCoordinator = new RefactorCoordinator(
  store,
  {
    ...fixture.port,
    current: async (group, outcome) => {
      checkRefactorBuffers(group, outcome);
      await checkRefactorDrafts(group, runtimeDrafts);
    },
    publish: publishRefactorBuffers,
    decide: async (decision) => {
      if (decision.drafts === null) throw new Error("Fixture expected durable resource drafts");
      const context = await fixture.port.authority();
      await coordinator.verifyReceipt(
        context,
        fixture.proposal,
        decision.drafts,
        decision.acceptance.operationId
      );
      check(
        true,
        "Private verification authenticates actual prepared strict-IDB receipt before fake Host moves"
      );
      check(
        decision.drafts.descendants.length === 3,
        "Receipt contains complete dirty source and displaced descendant revisions"
      );

      return fixture.port.decide(decision);
    },
  },
  "utf-16"
);

const controller = new RefactorController("fixture", coordinator);

const facts: string[] = [];

const check = (ok: boolean, fact: string) => {
  if (!ok) throw new Error(fact);
  facts.push(fact);
};

let accepted: DraftGroup | null = null;

export const resourceProof = {
  async collision() {
    resetBuffers();

    for (const path of ["/checkout/source/a", "/checkout/target/a"]) {
      ensureBuffer({
        file: { hostKey: "fixture", workspaceId: "fixture-workspace", path },
        root: "/checkout",
        line: null,
        column: null,
        onEdit: () => {},
        onDirectory: () => {},
      });
      await whenLoaded(fileKey("fixture", path));
    }

    for (const original of fixture.originals.slice(0, 2)) {
      const view = viewOf(fileKey("fixture", original.canonicalPath));

      if (view === null) throw new Error("Collision buffer did not load");

      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: original.text } });
    }

    const originals = [...openRefactorDocuments("fixture"), fixture.originals[2]!];
    const collision = resourceFixture(originals);

    const c: RefactorCoordinator = new RefactorCoordinator(
      store,
      {
        ...collision.port,
        current: async (group, outcome) => checkRefactorBuffers(group, outcome),
        decide: async (decision) => {
          if (decision.drafts === null) throw new Error("Missing open-collision receipt");
          await c.verifyReceipt(
            await collision.port.authority(),
            collision.proposal,
            decision.drafts,
            decision.acceptance.operationId
          );

          return collision.port.decide(decision);
        },
        publish: (group, previous) => {
          if (previous.state === "prepared")
            check(
              bufferOf(fileKey("fixture", "/checkout/target/a"))?.settle != null,
              "Displaced dirty buffer has a real pending settle before reconciliation"
            );

          publishRefactorBuffers(group, previous);
        },
      },
      "utf-16"
    );

    const group = await c.accept(
      await c.preview(collision.proposal),
      "collision",
      "collision",
      "fixture"
    );

    const reopenedCollision = await indexedDbGroups().get(group.id);

    check(
      reopenedCollision?.originals.length === 3 &&
        reopenedCollision.originals.some((doc) => doc.text === "overwritten unsaved"),
      "Open-collision strict-IDB reopen retains complete three dirty originals"
    );

    check(
      !runtimeDrafts.has("fixture", "/checkout/target/a"),
      "Closing overwritten pending dirty buffer emits no newer legacy draft over grouped source"
    );

    check(
      group.originals.some((doc) => doc.text === "overwritten unsaved") &&
        openRefactorDocuments("fixture").some(
          (doc) => doc.canonicalPath === "/checkout/target/a" && doc.text === "source unsaved"
        ),
      "Real open source rekeys to destination while displaced original remains in group"
    );

    const restored = await c.recover(group.id, "recover");

    check(
      restored.documents.some(
        (doc) => doc.canonicalPath === "/checkout/target/a" && doc.text === "overwritten unsaved"
      ) &&
        openRefactorDocuments("fixture").some(
          (doc) => doc.canonicalPath === "/checkout/source/a" && doc.text === "source unsaved"
        ),
      "Open-collision guarded recovery restores source buffer and displaced destination text"
    );

    resetBuffers();

    return facts;
  },
  async offer(complete = false) {
    if (complete) fixture.complete();
    bindRefactors(controller, "/checkout");
    const count = fixture.calls.filter((call) => call === "accept").length;
    await controller.offer(fixture.proposal);
    check(
      fixture.calls.filter((call) => call === "accept").length === count,
      "Resource server request requires explicit UI acceptance"
    );
  },
  async accepted(partial: boolean) {
    accepted = controller.state.getState().group;
    check(
      accepted?.state === (partial ? "partial" : "applied"),
      "Actual resource Accept receives authoritative ordered outcome"
    );
    const reopened = await indexedDbGroups().get(accepted!.id);
    check(
      reopened?.originals.map((doc) => doc.text).join("|") ===
        "source unsaved|overwritten unsaved|deleted unsaved",
      "Strict group reopen retains all source, overwritten and deleted dirty originals"
    );

    check(
      reopened?.documents.find((doc) => doc.canonicalPath === "/checkout/target/a")?.text ===
        "source unsaved",
      "Ordered overwrite rename projects source draft to destination"
    );

    check(
      reopened?.documents.some((doc) => doc.canonicalPath === "/checkout/created") === true,
      "Confirmed create appears in durable projection"
    );

    check(
      reopened?.documents.some((doc) => doc.canonicalPath === "/checkout/victim/a") === partial,
      "Delete projection follows applied or failed receipt step"
    );

    const file = {
      hostKey: "fixture",
      workspaceId: "fixture-workspace",
      path: "/checkout/target/a",
    };

    ensureBuffer({
      file,
      root: "/checkout",
      line: null,
      column: null,
      onEdit: () => {},
      onDirectory: () => {},
    });
    await whenLoaded(fileKey(file.hostKey, file.path));
    const view = viewOf(fileKey(file.hostKey, file.path));
    document.getElementById("editor")?.replaceChildren(...(view === null ? [] : [view.dom]));
    const opened = openRefactorDocuments("fixture").find((doc) => doc.canonicalPath === file.path);
    check(
      opened?.text === "source unsaved" &&
        opened.version ===
          reopened?.documents.find((doc) => doc.canonicalPath === file.path)?.version &&
        opened.draftRevision ===
          reopened?.documents.find((doc) => doc.canonicalPath === file.path)?.draftRevision,
      "Actual reopened CodeMirror retains grouped text, document and draft revisions for guarded undo"
    );
    checkRefactorBuffers(accepted!);

    const kv = memoryKeyValue();
    writeDraft(
      kv,
      {
        hostKey: "fixture",
        path: "/checkout/target/a",
        text: "newer closed resource draft",
        base: fixture.originals[0]!.diskVersion,
      },
      accepted!.updatedAt + 1
    );

    const files: EditorFiles = {
      read: () =>
        Promise.resolve({
          kind: "text",
          text: "base",
          version: fixture.originals[0]!.diskVersion!,
        }),
      write: () => Promise.reject(new Error("Unexpected save")),
      watch: () => () => {},
    };

    const inventory = await collectInventory(
      fixture.proposal,
      "fixture",
      [],
      kv,
      createDraftStore(kv, null),
      files,
      store
    );

    check(
      inventory.find((doc) => doc.canonicalPath === "/checkout/target/a")?.text ===
        "newer closed resource draft",
      "Actual strict-IDB grouped inventory preserves newer closed legacy work"
    );

    return facts;
  },
  async restored(intent: "recover" | "undo") {
    const restored = await indexedDbGroups().get(accepted!.id);
    check(
      restored?.state === "restored",
      "Actual recovery or undo button restores durable resource draft group"
    );

    check(
      restored?.documents.map((doc) => doc.text).join("|") ===
        "source unsaved|overwritten unsaved|deleted unsaved",
      "Recovery preserves overwritten and deleted originals in readback"
    );

    check(
      restored?.outcome?.receiptRevision === accepted!.outcome!.receiptRevision + 1,
      "Recovery receipt revision advances persisted CAS"
    );

    check(
      fixture.calls.at(-1) === intent,
      "Actual UI routes recover versus undo without new acceptance"
    );

    if (intent === "undo") resetBuffers();

    return facts;
  },
};

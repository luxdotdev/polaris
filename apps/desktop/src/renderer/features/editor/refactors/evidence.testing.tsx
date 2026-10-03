import { resourceProof } from "./resources.evidence.ts";
import type { LanguageTreeOperationOutcome } from "@polaris/protocol";
import "../../../styles.css";
import { createRoot } from "react-dom/client";
import { RefactorPreview } from "../ui/RefactorPreview.tsx";
import { RefactorController, bindRefactors } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { indexedDbGroups } from "./storage.ts";
import { doc, fixture } from "./testing.ts";
import { draftReceipt, type DraftGroup } from "./group.ts";
import { memoryKeyValue, fileKey } from "../model/drafts.ts";
import {
  ensureBuffer,
  configureEditor,
  viewOf,
  whenLoaded,
  resetBuffers,
} from "../runtime/buffers.ts";
import {
  openRefactorDocuments,
  checkRefactorBuffers,
  checkRefactorDrafts,
  publishRefactorBuffers,
} from "../runtime/refactorBuffers.ts";
import { collectInventory } from "./inventory.ts";
import { createDraftStore } from "../model/draftStore.ts";
import type { EditorFiles } from "../files/port.ts";
import { proposal } from "./testing.ts";

const hostKey = "fixture";

const store = indexedDbGroups();

const f = fixture();

const second = doc("/checkout/a-long-unopened-file-with-dirty-text.ts");

const multiProposal = {
  ...f.proposal,
  label: "Rename symbol in two files",
  fence: {
    ...f.proposal.fence,
    documents: [...f.proposal.fence.documents, { uri: second.uri, version: second.version }],
  },
  snapshots: [
    ...f.proposal.snapshots,
    {
      uri: second.uri,
      canonicalPath: second.canonicalPath,
      diskText: second.diskText,
      diskVersion: second.diskVersion,
      buffer: second.buffer,
    },
  ],
  edit: {
    changes: { ...f.proposal.edit.changes, [second.uri]: f.proposal.edit.changes![doc().uri]! },
  },
};

f.setInventory([doc(), second]);

const controller = new RefactorController(
  hostKey,
  new RefactorCoordinator(store, f.port, "utf-16")
);

bindRefactors(controller, "/checkout");

const root = document.getElementById("root");

if (root === null) throw new Error("Fixture mount missing");

createRoot(root).render(<RefactorPreview hostKey={hostKey} root="/checkout" />);

const facts: string[] = [];

const check = (ok: boolean, fact: string) => {
  if (!ok) throw new Error(fact);
  facts.push(fact);
};

const rejected = async (run: () => Promise<void>, fact: string) => {
  let failed = false;

  try {
    await run();
  } catch {
    failed = true;
  }

  check(failed, fact);
};

let durable: DraftGroup | null = null;

let crashReady = false;

const controls = {
  async offer() {
    const accepted = f.calls.filter((call) => call === "accept").length;
    await controller.offer(multiProposal);
    check(
      f.calls.filter((call) => call === "accept").length === accepted,
      "server applyEdit never autoaccepted"
    );
  },
  async accepted() {
    durable = controller.state.getState().group;
    check(durable?.state === "applied", "Actual Accept button commits strict IndexedDB group");
    const reopened = await indexedDbGroups().get(durable!.id);
    check(
      reopened?.documents[0]?.text === "aλb\r\n",
      "Reopened IndexedDB retains closed-file draft"
    );
    check(
      reopened?.originals[0]?.text === "a😀b\r\n",
      "Reopened IndexedDB retains original Unicode/CRLF text"
    );
    await rejected(
      () =>
        controller.coordinator.verifyReceipt(
          { ...f.proposal.fence.context, clientId: "intruder" },
          f.proposal,
          draftReceipt(durable!),
          durable!.operationId
        ),
      "Wrong independently authenticated owner rejected"
    );

    return facts;
  },
  async abort() {
    const group = durable!;
    // oxlint-disable-next-line typescript/unbound-method -- Fault injection preserves the native method and calls it with its original IDBObjectStore receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      this.transaction.abort();

      return request;
    };

    try {
      await rejected(
        () => store.commit({ ...group, revision: group.revision + 1 }, group.revision),
        "Actual IndexedDB abort rejects persistence"
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }

    const reopened = await indexedDbGroups().get(group.id);
    check(reopened?.revision === group.revision, "Aborted transaction rolls back after reopen");
  },
  async quota() {
    const group = durable!;
    // oxlint-disable-next-line typescript/unbound-method -- Fault injection preserves the native method and calls it with its original IDBObjectStore receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("Fixture quota", "QuotaExceededError");
    };

    try {
      await rejected(
        () => store.commit({ ...group, revision: group.revision + 1 }, group.revision),
        "Injected quota failure aborts actual strict transaction"
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }

    check(
      (await indexedDbGroups().get(group.id))?.revision === group.revision,
      "Quota failure leaves prior durable originals intact"
    );
  },
  async strict() {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, "durability");
    Object.defineProperty(IDBTransaction.prototype, "durability", {
      configurable: true,
      get: () => "default",
    });

    try {
      await rejected(
        () => store.commit({ ...durable!, revision: durable!.revision + 1 }, durable!.revision),
        "Missing strict durability fails closed"
      );
    } finally {
      if (descriptor !== undefined)
        Object.defineProperty(IDBTransaction.prototype, "durability", descriptor);
    }
  },
  async crash() {
    const group = durable!;
    // oxlint-disable-next-line typescript/unbound-method -- Fault injection preserves the native method and calls it with its original IDBObjectStore receiver.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      const tx = this.transaction;

      const keepAlive = () => {
        if (crashReady)
          tx.objectStore("groups").get(group.id).addEventListener("success", keepAlive);
      };

      request.addEventListener("success", () => {
        crashReady = true;
        keepAlive();
      });
      setTimeout(() => {
        try {
          tx.abort();
        } catch {}
      }, 5000);

      return request;
    };

    try {
      await store.commit(
        { ...group, revision: group.revision + 1, message: "uncommitted crash value" },
        group.revision
      );
    } finally {
      IDBObjectStore.prototype.put = put;
    }
  },
  get crashReady() {
    return crashReady;
  },
  async reopened() {
    const groups = await store.list();
    const group = groups.find((item) => item.state === "applied");
    check(
      group !== undefined && group.message !== "uncommitted crash value",
      "Actual isolated Electron SIGKILL rolls back uncommitted transaction"
    );
    durable = group ?? null;
    await controller.restore();
    check(
      controller.state.getState().group?.id === group?.id,
      "Restart exposes recovery group without replaying accept"
    );

    return { facts, id: group?.id, revision: group?.revision };
  },
  async unknownAndStale() {
    const lost = fixture();

    const coordinator = new RefactorCoordinator(
      store,
      {
        ...lost.port,
        decide: async () => {
          lost.calls.push("lost");
          throw new Error("Disconnected after send");
        },
      },
      "utf-16"
    );

    const group = await coordinator.accept(
      await coordinator.preview(lost.proposal),
      "unknown-group",
      "unknown-operation",
      hostKey
    );

    check(
      (await indexedDbGroups().get(group.id))?.state === "unknown",
      "Unknown Host outcome survives actual IndexedDB reopen"
    );
    await rejected(async () => {
      await coordinator.status(group.id);
    }, "Unknown status queries without replaying acceptance");
    check(
      lost.calls.filter((call) => call === "lost").length === 1,
      "Unknown operation never reaccepted"
    );
    const stale = fixture();
    const staleCoordinator = new RefactorCoordinator(store, stale.port, "utf-16");
    const preview = await staleCoordinator.preview(stale.proposal);
    stale.setInventory([doc("/checkout/a", "newer user text")]);
    await rejected(async () => {
      await staleCoordinator.accept(preview, "stale-group", "stale-operation", hostKey);
    }, "Actual stale inventory refuses before storage or Host mutation");
    check(
      (await store.get("stale-group")) === null,
      "Stale preview has no persisted acceptance group"
    );

    return facts;
  },
  async runtime() {
    let diskText = "base\r\n";
    let writes = 0;
    const kv = memoryKeyValue();
    const sample = doc();

    const files: EditorFiles = {
      read: () => Promise.resolve({ kind: "text", text: diskText, version: sample.diskVersion! }),
      write: (_target, text) => {
        writes++;
        diskText = text;

        return Promise.resolve({ kind: "written", version: sample.diskVersion! });
      },
      watch: () => () => {},
    };

    configureEditor({
      files,
      kv,
      groups: store,
      prefs: () => ({ vim: false, autosave: true }),
      canWrite: () => true,
      hostLabel: () => hostKey,
      hostHome: () => null,
    });
    const file = { hostKey, workspaceId: "fixture-workspace", path: "/checkout/runtime" };
    ensureBuffer({
      file,
      root: "/checkout",
      line: null,
      column: null,
      onEdit: () => {},
      onDirectory: () => {},
    });
    await whenLoaded(fileKey(hostKey, file.path));
    const view = viewOf(fileKey(hostKey, file.path));

    if (view === null) throw new Error("Runtime view missing");
    document.getElementById("editor")?.replaceChildren(view.dom);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "a😀b\r\n" } });
    const snapshot = openRefactorDocuments(hostKey)[0]!;
    const input = proposal(snapshot);
    const runtimeFixture = fixture();

    const port = {
      ...runtimeFixture.port,
      authority: () => Promise.resolve(input.fence.context),
      inventory: () =>
        collectInventory(
          input,
          hostKey,
          openRefactorDocuments(hostKey),
          kv,
          createDraftStore(kv, null),
          files,
          store
        ),
      current: async (group: DraftGroup, outcome?: LanguageTreeOperationOutcome) => {
        checkRefactorBuffers(group, outcome);
        await checkRefactorDrafts(group, createDraftStore(kv, null));
      },
      publish: publishRefactorBuffers,
    };

    const coordinator = new RefactorCoordinator(store, port, "utf-16");
    const preview = await coordinator.preview(input);
    const group = await coordinator.accept(preview, "runtime-group", "runtime-operation", hostKey);
    check(
      view.state.sliceDoc() === "aλb\r\n",
      "Actual CodeMirror view receives accepted persistent draft"
    );
    await new Promise((resolve) => setTimeout(resolve, 1100));
    check(
      writes === 0 && diskText === "base\r\n",
      "Accepted draft never triggers configured autosave"
    );
    await coordinator.recover(group.id, "undo");
    check(
      view.state.sliceDoc() === "a😀b\r\n",
      "Coordinated undo restores actual CodeMirror original"
    );
    view.dispatch({ changes: { from: 0, insert: "newer " } });
    await rejected(async () => {
      await coordinator.recover(group.id, "undo");
    }, "Intervening user typing prevents grouped undo");
    resetBuffers();

    return facts;
  },
  async measure() {
    const legacy = createDraftStore(localStorage, null);
    const original = durable!;

    const documents = Array.from({ length: 8 }, (_, index) => ({
      ...doc("/checkout/measure-" + index, "x".repeat(1024)),
      version: 0,
      draftRevision: 0,
    }));

    let revision = 0;

    const group: DraftGroup = {
      ...original,
      id: "measurement",
      operationId: "measurement-operation",
      revision: 0,
      originals: documents,
      documents,
      touched: documents.map((item) => item.canonicalPath),
    };

    const legacySamples: number[] = [];
    const groupSamples: number[] = [];
    const samples = { legacy: legacySamples, group: groupSamples };

    for (let iteration = 0; iteration < 6; iteration++) {
      const start = performance.now();

      for (const document of documents) {
        if (
          !legacy.write({
            hostKey: "measurement",
            path: document.canonicalPath,
            text: document.text,
            base: document.diskVersion,
          })
        )
          throw new Error("Legacy control storage failed");
      }

      const legacyTime = performance.now() - start;
      const groupStart = performance.now();
      await store.commit({ ...group, revision }, revision === 0 ? null : revision - 1);
      revision++;
      const groupTime = performance.now() - groupStart;

      if (iteration > 0) {
        samples.legacy.push(legacyTime);
        samples.group.push(groupTime);
      }
    }

    for (const document of documents) legacy.drop("measurement", document.canonicalPath);

    return {
      samples,
      bounds:
        "8 files x 1KiB, 1 warmup + 5 paired samples. Unchanged accepted per-path localStorage DraftStore control versus strict transactional group; differing durability semantics, tiny loaded fixture, no whole-App budget certification.",
    };
  },
  facts: () => facts,
};

window.refactorProof = controls;

window.resourceProof = resourceProof;

declare global {
  interface Window {
    refactorProof: typeof controls;
    resourceProof: typeof resourceProof;
  }
}

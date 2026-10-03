/// <reference lib="dom" />
import { Schema } from "effect";
import {
  DraftDocument,
  DraftGroup,
} from "../../../apps/desktop/src/renderer/features/editor/refactors/group.ts";
import {
  configureEditor,
  ensureBuffer,
  whenLoaded,
  bufferOf,
  resetBuffers,
  discardBuffer,
} from "../../../apps/desktop/src/renderer/features/editor/runtime/buffers.ts";
import { editorStore } from "../../../apps/desktop/src/renderer/features/editor/runtime/store.ts";
import { fileKey } from "../../../apps/desktop/src/renderer/features/editor/model/drafts.ts";
import { indexedDbGroups } from "../../../apps/desktop/src/renderer/features/editor/refactors/storage.ts";
import { RefactorCoordinator } from "../../../apps/desktop/src/renderer/features/editor/refactors/coordinator.ts";
import { fixture } from "../../../apps/desktop/src/renderer/features/editor/refactors/testing.ts";

const check = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};

/** Port of R1 discard.testing.ts; storage is native isolated-profile IDB/localStorage. */
const run = async () => {
  resetBuffers();
  const f = fixture();
  const underlying = indexedDbGroups();
  const coordinator = new RefactorCoordinator(underlying, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "joint-discard",
    "joint-operation",
    "host"
  );

  const original = group.originals[0];

  const expectedOriginals = Schema.decodeUnknownSync(Schema.Array(DraftDocument))(group.originals);

  if (!original?.diskVersion) throw new Error("Missing original discard version");
  const version = original.diskVersion;
  let release = () => {};

  let entered = () => {};

  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });

  let lists = 0;
  let refuse = false;

  configureEditor({
    groups: {
      ...underlying,
      list: async () => {
        lists++;

        if (lists === 3) {
          entered();
          await gate;
        }

        return underlying.list();
      },
    },
    kv: {
      get length() {
        return localStorage.length;
      },
      key: (index) => localStorage.key(index),
      getItem: (key) => localStorage.getItem(key),
      removeItem: (key) => localStorage.removeItem(key),
      setItem: (key, value) => {
        if (refuse) throw new Error("Injected write refusal");
        localStorage.setItem(key, value);
      },
    },
    files: {
      read: () => Promise.resolve({ kind: "text", text: "base", version }),
      write: () => Promise.reject(new Error("No implicit save")),
      watch: () => () => {},
    },
    prefs: () => ({ vim: false, autosave: false }),
    canWrite: () => true,
    hostLabel: () => "Fake Host",
    hostHome: () => null,
  });

  const key = fileKey("host", "/checkout/a");

  try {
    ensureBuffer({
      file: { hostKey: "host", workspaceId: "workspace", path: "/checkout/a" },
      root: "/checkout",
      line: null,
      column: null,
      onEdit: () => {},
      onDirectory: () => {},
    });
    await whenLoaded(key);
    const buffer = bufferOf(key);

    if (!buffer?.view) throw new Error("Missing native discard view");
    document.getElementById("editor")?.appendChild(buffer.view.dom);
    const pending = discardBuffer("host", "/checkout/a");
    await waiting;
    buffer.view.dispatch({
      changes: { from: 0, to: buffer.view.state.doc.length, insert: "newer live work" },
    });
    refuse = true;
    release();
    let failure = "";

    try {
      await pending;
    } catch (cause) {
      failure = String(cause);
    }

    check(
      failure.includes("Cannot preserve the draft"),
      "Discard must surface preservation refusal"
    );
    const alert = document.createElement("p");
    alert.setAttribute("role", "alert");
    alert.textContent = failure;
    document.body.appendChild(alert);
    check(bufferOf(key) === buffer, "Live buffer identity retained");
    check(
      buffer.view.state.sliceDoc() === "newer live work",
      "Intervening native view edit retained"
    );
    check(editorStore.getState().buffers[key]?.unkept === true, "Unsafe discard marked unkept");
    const reopened = await indexedDbGroups().get(group.id);

    if (!reopened) throw new Error("Missing durable intervention after reopen");
    const equal = Schema.toEquivalence(Schema.Array(DraftDocument));
    check(equal(reopened.originals, expectedOriginals), "Complete durable originals unchanged");
    check(
      Schema.toEquivalence(DraftGroup.fields.proposal)(reopened.proposal, group.proposal),
      "Proposal unchanged"
    );
    check(reopened.fingerprint === group.fingerprint, "Receipt fingerprint unchanged");
    check(
      reopened.state === "conflict" && reopened.revision > group.revision,
      "Durable intervention advances conflict revision"
    );

    return [
      "Held async discard retains actual CodeMirror live edit on injected localStorage refusal",
      "Native strict IndexedDB reopened original unchanged",
      "Fixture displays caught safe discard failure; no implicit save",
    ];
  } finally {
    refuse = false;
    release();
    resetBuffers();
  }
};

Object.assign(window, { jointDiscard: { run } });

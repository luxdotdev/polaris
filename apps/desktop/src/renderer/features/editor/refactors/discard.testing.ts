import assert from "node:assert/strict";
import {
  configureEditor,
  ensureBuffer,
  whenLoaded,
  bufferOf,
  resetBuffers,
} from "../runtime/buffers.ts";
import { editorStore } from "../runtime/store.ts";
import { memoryKeyValue, fileKey } from "../model/drafts.ts";
import { memoryGroups } from "./storage.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { fixture } from "./testing.ts";
import { discardBuffer } from "../runtime/buffers.ts";

const f = fixture();

const underlying = memoryGroups();

const coordinator = new RefactorCoordinator(underlying, f.port, "utf-16");

const group = await coordinator.accept(
  await coordinator.preview(f.proposal),
  "group",
  "operation",
  "host"
);

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

const kv = memoryKeyValue();

configureEditor({
  groups: {
    ...underlying,
    list: async () => {
      lists++;
      // Initial load and captured projection read precede the actual intervention wait.

      if (lists === 3) {
        entered();
        await gate;
      }

      return underlying.list();
    },
  },
  kv: {
    ...kv,
    get length() {
      return kv.length;
    },
    setItem: (key, value) => {
      if (refuse) throw new Error("Injected write refusal");
      kv.setItem(key, value);
    },
  },
  files: {
    read: () =>
      Promise.resolve({ kind: "text", text: "base", version: group.originals[0]!.diskVersion! }),
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
  assert.ok(buffer?.view);
  const pending = discardBuffer("host", "/checkout/a");
  await waiting;
  buffer.view.dispatch({
    changes: { from: 0, to: buffer.view.state.doc.length, insert: "newer live work" },
  });
  refuse = true;
  release();
  await assert.rejects(pending, /Cannot preserve the draft/);
  assert.equal(bufferOf(key), buffer);
  assert.equal(buffer.view.state.sliceDoc(), "newer live work");
  assert.equal(editorStore.getState().buffers[key]?.unkept, true);
  assert.equal((await underlying.get(group.id))?.originals[0]?.text, "a😀b\r\n");
  process.stdout.write(
    "Actual discard write refusal: live view/text and immutable original retained; safe error surfaced\n"
  );
} finally {
  refuse = false;
  release();
  resetBuffers();
}

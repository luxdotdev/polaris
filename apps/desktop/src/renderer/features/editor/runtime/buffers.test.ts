import "../../../test/dom.testing.ts";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import type { EditorFile } from "../api.ts";
import { createFakeFiles, type FakeFiles, type FakeOptions } from "../files/fake.ts";
import type { EditorFiles } from "../files/port.ts";
import { fileKey, type KeyValue, memoryKeyValue } from "../model/drafts.ts";
import type { Unreadable } from "../model/notices.ts";
import {
  attachView,
  AUTOSAVE_MS,
  bufferOf,
  configureEditor,
  detachView,
  ensureBuffer,
  hasUnsaved,
  keepMine,
  moveBuffer,
  type OpenInput,
  releaseBuffer,
  resetBuffers,
  saveAll,
  saveBuffer,
  takeTheirs,
  viewOf,
  whenLoaded,
} from "./buffers.ts";
import { editorStore, modelOf } from "./store.ts";

const HOST = "host";

const A = "/w/a.ts";

const B = "/w/b.ts";

const keyOf = (path: string) => fileKey(HOST, path);

const fileOf = (path: string): EditorFile => ({ hostKey: HOST, workspaceId: "ws", path });

let files: FakeFiles;

let kv: KeyValue;

let autosave = false;

let writable = true;

const edited: Array<string> = [];

const directories: Array<string> = [];

/** Fresh files on one Host; `override` replaces part of the port, e.g. a watch that misses changes. */
const configure = (
  seed: Readonly<Record<string, string>>,
  options: FakeOptions = {},
  override: Partial<EditorFiles> = {}
) => {
  files = createFakeFiles({ [HOST]: seed }, options);
  configureEditor({
    files: { ...files, ...override },
    kv,
    prefs: () => ({ vim: false, autosave }),
    canWrite: () => writable,
    hostLabel: () => "Fake Host",
    hostHome: () => null,
  });
};

const ensure = (path: string, input: Partial<OpenInput> = {}) =>
  ensureBuffer({
    file: fileOf(path),
    root: "/w",
    line: null,
    column: null,
    onEdit: (file) => edited.push(file.path),
    onDirectory: () => directories.push(path),
    ...input,
  });

const open = async (path: string, input: Partial<OpenInput> = {}) => {
  const buffer = ensure(path, input);

  await whenLoaded(buffer.key);

  return buffer;
};

const view = (path: string) => {
  const found = viewOf(keyOf(path));

  if (found === null) throw new Error(`${path} has no editor`);

  return found;
};

const text = (path: string) => view(path).state.sliceDoc();

const type = (path: string, insert: string) => {
  const target = view(path);

  target.dispatch({ changes: { from: target.state.doc.length, insert } });
};

const replace = (path: string, insert: string) => {
  const target = view(path);

  target.dispatch({ changes: { from: 0, to: target.state.doc.length, insert } });
};

const statusOf = (path: string) => editorStore.getState().buffers[keyOf(path)];

const model = (path: string) => {
  const found = modelOf(keyOf(path));

  if (found === null) throw new Error(`${path} hasn't loaded`);

  return found;
};

const until = async (done: () => boolean, label: string) => {
  const deadline = Date.now() + 2000;

  while (!done()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
};

beforeEach(() => {
  kv = memoryKeyValue();
  autosave = false;
  writable = true;
  edited.length = 0;
  directories.length = 0;
});

afterEach(() => {
  jest.useRealTimers();
  resetBuffers();
  editorStore.setState({ active: null });
});

describe("opening", () => {
  test("a file opens with the disk's text, clean, and its line revealed", async () => {
    configure({ [A]: "one\ntwo\nthree\n" });
    await open(A, { line: 2, column: 3 });

    expect(text(A)).toBe("one\ntwo\nthree\n");
    expect(model(A)).toMatchObject({ base: "one\ntwo\nthree\n", dirty: false, conflict: null });
    expect(view(A).state.selection.main.head).toBe("one\ntw".length);
  });

  test("opening an open file again keeps its editor and edits", async () => {
    configure({ [A]: "kept" });
    const first = await open(A);

    type(A, " and edited");

    expect(await open(A)).toBe(first);
    expect(text(A)).toBe("kept and edited");
  });

  test.each([
    ["binary", { [A]: "\u0000\u0001" }, { kind: "binary", size: 2 }],
    ["missing", {}, { kind: "missing" }],
  ] as const)("a %s file says so instead of showing text", async (_, seed, status) => {
    configure(seed);
    await open(A);

    expect(statusOf(A)?.status).toEqual(status);
    expect(viewOf(keyOf(A))).toBeNull();
  });

  test("a missing file the user asked for tells the caller, to drop the tab", async () => {
    configure({});
    const reasons: Array<Unreadable> = [];

    ensure(A, { onUnreadable: (reason) => reasons.push(reason) });
    await until(() => reasons.length > 0, "the unreadable notice");

    expect(reasons).toEqual([{ kind: "missing" }]);
  });

  test("a folder opened as a file tells the caller, to drop the tab", async () => {
    configure({}, {}, { read: () => Promise.reject(new Error("EISDIR: illegal operation")) });
    ensure(A);
    await until(() => directories.length > 0, "the folder notice");

    expect(directories).toEqual([A]);
  });

  test("a read the Daemon refuses shows its reason", async () => {
    configure({}, {}, { read: () => Promise.reject(new Error("Permission denied")) });
    await open(A);

    expect(statusOf(A)?.status).toEqual({ kind: "error", message: "Permission denied" });
  });
});

describe("editing", () => {
  test("an edit marks the file dirty at once and tells the caller, to pin a preview tab", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, "!");

    expect(model(A).dirty).toBe(true);
    expect(edited).toEqual([A]);
    expect(hasUnsaved(HOST, A)).toBe(true);
  });

  test("editing back to the disk's text reads clean once the edits settle", async () => {
    configure({ [A]: "base" });
    await open(A);
    jest.useFakeTimers();
    type(A, "!");
    replace(A, "base");

    expect(model(A).dirty).toBe(true);

    jest.advanceTimersByTime(AUTOSAVE_MS);

    expect(model(A).dirty).toBe(false);
  });

  test("with autosave on, a pause after typing saves the file", async () => {
    autosave = true;
    configure({ [A]: "base" });
    await open(A);
    jest.useFakeTimers();
    type(A, " typed");
    jest.advanceTimersByTime(AUTOSAVE_MS - 1);

    expect(files.text(HOST, A)).toBe("base");

    jest.advanceTimersByTime(1);
    jest.useRealTimers();
    await until(() => files.text(HOST, A) === "base typed", "the autosave");

    expect(model(A).dirty).toBe(false);
  });
});

describe("saving", () => {
  test("saving writes the text and leaves the file clean, ready for the next save", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " one");

    expect(await saveBuffer(keyOf(A))).toBe(true);
    expect(files.text(HOST, A)).toBe("base one");
    expect(model(A)).toMatchObject({ base: "base one", dirty: false, saving: null, error: null });

    type(A, " two");

    expect(await saveBuffer(keyOf(A))).toBe(true);
    expect(files.text(HOST, A)).toBe("base one two");
  });

  test("saving a clean file succeeds without writing", async () => {
    let writes = 0;

    configure(
      { [A]: "base" },
      {},
      {
        write: () => {
          writes++;

          return Promise.reject(new Error("no write expected"));
        },
      }
    );
    await open(A);

    expect(await saveBuffer(keyOf(A))).toBe(true);
    expect(writes).toBe(0);
  });

  test("saving every dirty file writes them all", async () => {
    configure({ [A]: "a", [B]: "b" });
    await open(A);
    await open(B);
    type(A, "1");
    type(B, "2");

    expect(await saveAll()).toBe(true);
    expect([files.text(HOST, A), files.text(HOST, B)]).toEqual(["a1", "b2"]);
  });

  test("a Host that can't save opens the file read-only, and saving writes nothing", async () => {
    writable = false;
    configure({ [A]: "base" });
    await open(A);
    type(A, "!");

    expect(statusOf(A)?.readOnly).toBe(true);
    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(files.text(HOST, A)).toBe("base");
  });

  test("a Daemon without files.write turns the file read-only and keeps the edits", async () => {
    configure({ [A]: "base" }, { readOnlyHosts: [HOST] });
    await open(A);
    type(A, "!");

    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(statusOf(A)?.readOnly).toBe(true);
    expect(model(A).dirty).toBe(true);
    expect(text(A)).toBe("base!");
  });

  test("a failed write keeps the edits and says why", async () => {
    configure({ [A]: "base" }, {}, { write: () => Promise.reject(new Error("Disk full")) });
    await open(A);
    type(A, "!");

    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(model(A)).toMatchObject({ dirty: true, saving: null, error: "Disk full" });
  });

  test("a save refused because the file was deleted says so and marks it deleted", async () => {
    configure({ [A]: "base" }, {}, { watch: () => () => {} });
    await open(A);
    type(A, "!");
    files.remove(HOST, A);

    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(model(A).error).toBe("This file was deleted on disk.");
    expect(statusOf(A)?.deleted).toBe(true);
  });
});

describe("the disk changing", () => {
  test("a clean file reloads in place when the disk changes", async () => {
    configure({ [A]: "before" });
    await open(A);
    files.agentWrite(HOST, A, "after");
    await until(() => text(A) === "after", "the reload");

    expect(model(A)).toMatchObject({ base: "after", dirty: false, conflict: null });
  });

  test("a file deleted on disk while open keeps its text and is marked deleted", async () => {
    configure({ [A]: "still here" });
    await open(A);
    files.remove(HOST, A);
    await until(() => statusOf(A)?.deleted === true, "the deletion");

    expect(text(A)).toBe("still here");
  });

  test("a change under unsaved edits is a conflict, and saving waits for a choice", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " mine");
    files.agentWrite(HOST, A, "theirs");
    await until(() => model(A).conflict !== null, "the conflict");

    expect(model(A).conflict?.theirs.text).toBe("theirs");
    expect(text(A)).toBe("base mine");
    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(files.text(HOST, A)).toBe("theirs");
  });

  test("a save the disk moved on under is refused into a conflict", async () => {
    configure({ [A]: "base" }, {}, { watch: () => () => {} });
    await open(A);
    type(A, " mine");
    files.agentWrite(HOST, A, "theirs");

    expect(await saveBuffer(keyOf(A))).toBe(false);
    expect(model(A).conflict?.theirs.text).toBe("theirs");
    expect(files.text(HOST, A)).toBe("theirs");
  });

  test("keeping mine resolves the conflict, and the next save overwrites theirs", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " mine");
    files.agentWrite(HOST, A, "theirs");
    await until(() => model(A).conflict !== null, "the conflict");
    keepMine(keyOf(A));

    expect(model(A)).toMatchObject({ conflict: null, dirty: true });
    expect(await saveBuffer(keyOf(A))).toBe(true);
    expect(files.text(HOST, A)).toBe("base mine");
  });

  test("taking theirs replaces the edits with the disk's text", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " mine");
    files.agentWrite(HOST, A, "theirs");
    await until(() => model(A).conflict !== null, "the conflict");
    takeTheirs(keyOf(A));

    expect(text(A)).toBe("theirs");
    expect(model(A)).toMatchObject({ conflict: null, dirty: false });
  });
});

describe("closing and drafts", () => {
  test("closing a dirty file keeps its edits as a draft, restored on the next open", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " unsaved");
    releaseBuffer(keyOf(A));

    expect(bufferOf(keyOf(A))).toBeUndefined();
    expect(statusOf(A)).toBeUndefined();
    expect(files.watching()).toBe(0);
    expect(hasUnsaved(HOST, A)).toBe(true);

    await open(A);

    expect(text(A)).toBe("base unsaved");
    expect(model(A)).toMatchObject({ dirty: true, conflict: null });
  });

  test("a draft made on an older disk reopens as a conflict with the disk's text", async () => {
    configure({ [A]: "base" });
    await open(A);
    type(A, " unsaved");
    releaseBuffer(keyOf(A));
    files.agentWrite(HOST, A, "changed while closed");
    await open(A);

    expect(text(A)).toBe("base unsaved");
    expect(model(A).conflict?.theirs.text).toBe("changed while closed");
  });

  test("closing before the edits settle, back at the disk's text, drops the draft", async () => {
    configure({ [A]: "base" });
    await open(A);
    jest.useFakeTimers();
    type(A, "!");
    jest.advanceTimersByTime(AUTOSAVE_MS);

    expect(hasUnsaved(HOST, A)).toBe(true);

    replace(A, "base");
    releaseBuffer(keyOf(A));

    expect(hasUnsaved(HOST, A)).toBe(false);
  });

  test("a renamed file keeps its editor, edits and draft at the new path", async () => {
    configure({ [A]: "base" });
    const buffer = await open(A);

    type(A, " moved");
    await moveBuffer(HOST, A, B);

    expect(bufferOf(keyOf(B))).toBe(buffer);
    expect(bufferOf(keyOf(A))).toBeUndefined();
    expect(statusOf(A)).toBeUndefined();
    expect(hasUnsaved(HOST, A)).toBe(false);
    expect(hasUnsaved(HOST, B)).toBe(true);
    expect(text(B)).toBe("base moved");
  });
});

describe("panes", () => {
  test("a file's editor goes into a pane once loaded, and becomes the active editor", async () => {
    configure({ [A]: "base" }, { latencyMs: 5 });
    const pane = document.createElement("div");
    const buffer = ensure(A);

    expect(attachView(buffer.key, pane)).toBe(false);

    await whenLoaded(buffer.key);

    expect(attachView(buffer.key, pane)).toBe(true);
    expect(pane.firstChild).toBe(view(A).dom);
    expect(editorStore.getState().active).toMatchObject({ path: A, view: view(A) });
  });

  test("taking an editor out of its pane clears the active editor", async () => {
    configure({ [A]: "base" });
    const pane = document.createElement("div");

    document.body.append(pane);
    await open(A);
    attachView(keyOf(A), pane);
    detachView(keyOf(A));
    pane.remove();

    expect(pane.childNodes).toHaveLength(0);
    expect(editorStore.getState().active).toBeNull();
  });
});

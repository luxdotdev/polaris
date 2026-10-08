import { describe, expect, test } from "bun:test";
import { RefactorController } from "./controller.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { draftReceipt, type DraftGroup } from "./group.ts";
import {
  hunksOf,
  linesPhrase,
  renameFiles,
  renameNames,
  visibleHunks,
  type Hunk,
} from "./renamePreview.ts";
import { doc, fixture, proposal } from "./testing.ts";
import { undoOwner } from "./undo.ts";
import { memoryGroups } from "./storage.ts";

const hunk = (line: number): Hunk => ({ line, removed: [], added: [] });

describe("rename preview hunks", () => {
  test("pairs the changed lines of a rename and skips unchanged ones", () => {
    expect(hunksOf("const A = 1;\nkeep;\nuse(A);\n", "const B = 1;\nkeep;\nuse(B);\n")).toEqual([
      {
        line: 1,
        removed: [{ line: 1, text: "const A = 1;" }],
        added: [{ line: 1, text: "const B = 1;" }],
      },
      { line: 3, removed: [{ line: 3, text: "use(A);" }], added: [{ line: 3, text: "use(B);" }] },
    ]);
    expect(hunksOf("same\n", "same\n")).toEqual([]);
  });

  test("a change in line count is one block", () => {
    expect(hunksOf("a\nb\n", "a\nx\ny\n")).toEqual([
      {
        line: 2,
        removed: [{ line: 2, text: "b" }],
        added: [
          { line: 2, text: "x" },
          { line: 3, text: "y" },
        ],
      },
    ]);
  });

  test("up to two hunks show; with more, the first and then the rest folded", () => {
    expect(visibleHunks([hunk(1), hunk(5)], false)).toHaveLength(2);
    expect(visibleHunks([hunk(1), hunk(5), hunk(9)], false)).toEqual([hunk(1)]);
    expect(visibleHunks([hunk(1), hunk(5), hunk(9)], true)).toHaveLength(3);
    expect(linesPhrase([hunk(31), hunk(44)])).toBe("lines 31 and 44");
    expect(linesPhrase([hunk(3)])).toBe("line 3");
    expect(linesPhrase([hunk(1), hunk(2), hunk(3), hunk(4)])).toBe("lines 1, 2, 3 and others");
  });

  test("the title splits into the two names", () => {
    expect(renameNames("Rename BASE to RETRY")).toEqual({ from: "BASE", to: "RETRY" });
    expect(renameNames("Rename to RETRY")).toBeNull();
  });

  test("files name their folder in the checkout and say when they had unsaved edits", () => {
    const files = renameFiles(
      {
        proposal: proposal(),
        originals: [doc("/checkout/src/a.ts", "A\n", false), doc("/checkout/b.ts", "A\n", true)],
        documents: [doc("/checkout/src/a.ts", "B\n", false), doc("/checkout/b.ts", "B\n", true)],
        touched: ["/checkout/src/a.ts", "/checkout/b.ts"],
        fingerprint: "f",
      },
      "/checkout"
    );

    expect(files.map((f) => [f.name, f.folder, f.unsaved, f.hunks.length])).toEqual([
      ["a.ts", "src", false, 1],
      ["b.ts", "", true, 1],
    ]);
  });
});

describe("accepting and undoing a multi-file rename", () => {
  test("a text-only rename's files with unsaved edits are not resource descendants", async () => {
    const f = fixture();
    const coordinator = new RefactorCoordinator(memoryGroups(), f.port, "utf-16");
    const group = await coordinator.accept(await coordinator.preview(f.proposal), "g", "o", "host");

    expect(group.originals[0]?.dirty).toBe(true);
    expect(draftReceipt(group).descendants).toEqual([]);
  });

  test("Cancel discards the preview at once, even when the Host can't be told", async () => {
    const f = fixture();

    const coordinator = new RefactorCoordinator(
      memoryGroups(),
      { ...f.port, decide: () => Promise.reject(new Error("not-ready")) },
      "utf-16"
    );

    const controller = new RefactorController("host", coordinator);
    controller.state.setState({ preview: await coordinator.preview(f.proposal) });
    await controller.reject();

    expect(controller.state.getState()).toMatchObject({ preview: null, error: null });
  });

  test("⌘Z belongs to an applied multi-file rename while the file reads as it left it", async () => {
    const f = fixture();
    const coordinator = new RefactorCoordinator(memoryGroups(), f.port, "utf-16");

    const applied = await coordinator.accept(
      await coordinator.preview(f.proposal),
      "g",
      "o",
      "host"
    );

    const controller = new RefactorController("host", coordinator);

    const group: DraftGroup = {
      ...applied,
      state: "applied",
      touched: ["/a.ts", "/b.ts"],
      documents: [doc("/a.ts", "B"), doc("/b.ts", "B")],
    };

    controller.state.setState({ group });

    expect(undoOwner([controller], "host", "/a.ts", "B")).toBe(controller);
    expect(undoOwner([controller], "host", "/a.ts", "B edited")).toBeNull();
    expect(undoOwner([controller], "other", "/a.ts", "B")).toBeNull();
    controller.state.setState({ group: { ...group, touched: ["/a.ts"] } });
    expect(undoOwner([controller], "host", "/a.ts", "B")).toBeNull();
  });
});

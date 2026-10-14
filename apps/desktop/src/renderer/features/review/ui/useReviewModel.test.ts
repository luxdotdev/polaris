import "../../../test/dom.testing.ts";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../../test/bridge.testing.ts";
import { standInBridge } from "../../bridge.ts";
import { parseFiles } from "../data/parseFiles.ts";
import { testsStore } from "../data/testsStore.ts";
import type { ReviewDiff } from "../data/useReviewDiff.ts";
import { viewedStore } from "../data/viewedStore.ts";
import type { ReviewFile, ReviewSection } from "../model/layout.ts";
import { noiseOf } from "../model/noise.ts";
import { fingerprint, indexPatch } from "../model/patch.ts";
import type { ReviewScale } from "../model/policy.ts";
import { emptyBook } from "../model/viewed.ts";
import { revealInDiff, revealStore, type ReviewAnnotation } from "../surface.ts";
import { headerStore } from "./FileHeader.tsx";
import { type PullViewed, type ReviewModelInput, useReviewModel } from "./useReviewModel.ts";

type ReadyDiff = Extract<ReviewDiff, { readonly kind: "ready" }>;

const filePatch = (path: string) => `diff --git a/${path} b/${path}
index 1111111..2222222 100644
--- a/${path}
+++ b/${path}
@@ -1,2 +1,2 @@
 keep
-old
+new
`;

interface Built {
  readonly section: ReviewSection;
  readonly bytes: Uint8Array;
}

/** A Turn's section from a real patch of `paths`, indexed as the Review indexes it. */
const turnSection = (id: string, turn: number, paths: ReadonlyArray<string>, start: number) => {
  const bytes = new TextEncoder().encode(paths.map(filePatch).join(""));

  const files = indexPatch(bytes, []).map((file, i): ReviewFile => ({
    key: `${id}:${file.path}`,
    index: start + i,
    section: id,
    file,
    fingerprint: fingerprint(bytes, file),
    ...noiseOf(file),
  }));

  const divider = { turn, harness: "claude", quote: `Turn ${turn}'s prompt` };

  return { section: { id, divider, files }, bytes } satisfies Built;
};

/** Turn 2 (newest, open) with a source and a test file; Turn 1 (older, folded) with one file. */
const diffOf = (scale: ReviewScale = "full"): ReadyDiff => {
  const built = [
    turnSection("t2", 2, ["src/serve.ts", "src/serve.test.ts"], 0),
    turnSection("t1", 1, ["src/old.ts"], 2),
  ];

  const parsed = built.flatMap(({ section, bytes }) => {
    const metadata = parseFiles({
      bytes,
      files: section.files.map((f) => f.file),
      keys: section.files.map((f) => f.key),
    });

    return section.files.flatMap((f, i) => {
      const one = metadata[i];

      return one === undefined ? [] : [[f.key, one] as const];
    });
  });

  return {
    kind: "ready",
    source: { hostKey: "h1", cwd: "/repo", sections: [], key: "k" },
    sections: built.map((b) => b.section),
    scale,
    parsed: scale === "list-only" ? new Map() : new Map(parsed),
    bytes: new Map(built.map((b) => [b.section.id, b.bytes])),
    size: 0,
    complete: true,
  };
};

const SESSION = "session:h1:s1";

const inputOf = (patch: Partial<ReviewModelInput> = {}): ReviewModelInput => ({
  subjectKey: SESSION,
  diff: diffOf(),
  findings: [],
  annotations: [],
  selection: null,
  pullViewed: null,
  intents: undefined,
  byIntent: false,
  ...patch,
});

const render = (input: ReviewModelInput) =>
  renderHook(({ value }) => useReviewModel(value), { initialProps: { value: input } });

const rowOf = (hook: ReturnType<typeof render>, key: string) =>
  hook.result.current.rows.find((r) => r.file.key === key);

const actions = () => {
  const current = headerStore.getState().actions;

  if (current === null) throw new Error("the model set no header actions");

  return current;
};

let bridge: FakeBridge;

beforeEach(() => {
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  standInBridge(null);
  viewedStore.setState({ book: emptyBook, pending: new Map() });
  testsStore.setState({ hidden: false });
  headerStore.setState({ rows: {}, actions: null });
  revealStore.setState({ request: null });
});

describe("the layout", () => {
  test("the newest Turn's files are open; the older Turn folds behind its divider", () => {
    const hook = render(inputOf());

    expect(hook.result.current.rows.map((r) => [r.file.key, r.collapsed])).toEqual([
      ["t2:src/serve.ts", false],
      ["t2:src/serve.test.ts", false],
      ["t1:src/old.ts", true],
    ]);
    expect(rowOf(hook, "t1:src/old.ts")?.divider?.folded).toBe(true);
    expect(hook.result.current.items.map((i) => i.item.id)).toEqual([
      "t2:src/serve.ts",
      "t2:src/serve.test.ts",
      "t1:src/old.ts",
    ]);
  });

  test("a file header's chevron collapses an open file and opens it again", () => {
    const hook = render(inputOf());

    act(() => actions().toggle("t2:src/serve.ts"));
    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(true);

    act(() => actions().toggle("t2:src/serve.ts"));
    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(false);
  });

  test("opening a folded Turn shows its files", () => {
    const hook = render(inputOf());

    act(() => actions().openSections(["t1"]));

    expect(rowOf(hook, "t1:src/old.ts")).toMatchObject({
      collapsed: false,
      divider: { folded: false },
    });
  });

  test("each file's header model follows its row", () => {
    render(inputOf());

    expect(headerStore.getState().rows["t2:src/serve.ts"]).toMatchObject({
      path: "src/serve.ts",
      additions: 1,
      deletions: 1,
      collapsed: false,
      viewed: false,
      divider: { label: "Turn 2" },
    });
  });
});

describe("Viewed in an Agent Session", () => {
  test("marking a file viewed collapses it, counts it, and outlives the hook", () => {
    const hook = render(inputOf());

    act(() => actions().setViewed("t2:src/serve.ts", true));

    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(true);
    expect(headerStore.getState().rows["t2:src/serve.ts"]?.viewed).toBe(true);
    expect(hook.result.current.progress).toMatchObject({ viewed: 1, total: 3 });

    hook.unmount();
    const again = render(inputOf());

    expect(rowOf(again, "t2:src/serve.ts")?.collapsed).toBe(true);
    expect(bridge.calls).toEqual([]);
  });

  test("a file the user collapsed and opened again still collapses once marked viewed", () => {
    const hook = render(inputOf());

    act(() => actions().toggle("t2:src/serve.ts"));
    act(() => actions().toggle("t2:src/serve.ts"));
    act(() => actions().setViewed("t2:src/serve.ts", true));

    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(true);
  });

  test("opening a viewed file from the file list expands it", () => {
    const hook = render(inputOf());

    act(() => actions().setViewed("t2:src/serve.ts", true));
    act(() => hook.result.current.open("t2:src/serve.ts"));

    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(false);
    expect(hook.result.current.openFile).toBe("t2:src/serve.ts");
  });

  test("unmarking it opens it again", () => {
    const hook = render(inputOf());

    act(() => actions().setViewed("t2:src/serve.ts", true));
    act(() => actions().setViewed("t2:src/serve.ts", false));

    expect(rowOf(hook, "t2:src/serve.ts")?.collapsed).toBe(false);
    expect(hook.result.current.progress).toMatchObject({ viewed: 0 });
  });
});

describe("Viewed on a pull request", () => {
  const pullViewed: PullViewed = {
    pull: { repo: { owner: "acme", name: "atlas" }, number: 7 },
    pullId: "PR_7",
    files: [
      { path: "src/old.ts", additions: 1, deletions: 1, changeType: "MODIFIED", viewed: "viewed" },
    ],
  };

  test("GitHub's marks are the files' state", () => {
    const hook = render(inputOf({ pullViewed }));

    expect(hook.result.current.progress).toMatchObject({ viewed: 1 });
  });

  test("a click shows at once and goes to GitHub", async () => {
    const hook = render(inputOf({ pullViewed }));

    act(() => actions().setViewed("t2:src/serve.ts", true));

    expect(headerStore.getState().rows["t2:src/serve.ts"]?.viewed).toBe(true);
    await waitFor(() =>
      expect(bridge.sent("github.files.setViewed")).toEqual([
        { pull: pullViewed.pull, pullId: "PR_7", path: "src/serve.ts", viewed: true },
      ])
    );
    expect(hook.result.current.progress).toMatchObject({ viewed: 2 });
  });

  test("GitHub refusing the click undoes it", async () => {
    bridge.refuse("github.files.setViewed", { code: "GitHubError", message: "no access" });
    const hook = render(inputOf({ pullViewed }));

    act(() => actions().setViewed("t2:src/serve.ts", true));

    await waitFor(() => expect(hook.result.current.progress).toMatchObject({ viewed: 1 }));
    expect(headerStore.getState().rows["t2:src/serve.ts"]?.viewed).toBe(false);
  });
});

describe("hiding tests", () => {
  test("hides the test file from the files, the diff and progress", () => {
    const hook = render(inputOf());

    expect(hook.result.current.tests).toEqual({ count: 1, hidden: false });

    act(() => testsStore.setState({ hidden: true }));

    expect(hook.result.current.files.map((f) => f.file.path)).toEqual([
      "src/serve.ts",
      "src/old.ts",
    ]);
    expect(hook.result.current.items.map((i) => i.path)).not.toContain("src/serve.test.ts");
    expect(hook.result.current.tests).toEqual({ count: 1, hidden: true });
  });

  test("a test file with a finding is never hidden", () => {
    const hook = render(
      inputOf({
        findings: [
          {
            id: "f1",
            path: "src/serve.test.ts",
            lines: { start: 2, end: 2, side: "new" },
            severity: "high",
            confidence: 0.9,
            title: "Flaky wait",
            reason: "",
            status: "open",
          },
        ],
      })
    );

    expect(hook.result.current.tests).toBeNull();
  });
});

describe("revealing a place", () => {
  test("a jump into a folded Turn opens the Turn and the file", () => {
    const hook = render(inputOf());

    act(() => revealInDiff("src/old.ts", 2));

    expect(rowOf(hook, "t1:src/old.ts")).toMatchObject({
      collapsed: false,
      divider: { folded: false },
    });
  });

  test("a jump to a hidden test file shows the tests again, then opens it", () => {
    testsStore.setState({ hidden: true });
    const hook = render(inputOf());

    act(() => actions().toggle("t2:src/serve.ts"));
    act(() => revealInDiff("src/serve.test.ts", 2));

    expect(testsStore.getState().hidden).toBe(false);
    expect(rowOf(hook, "t2:src/serve.test.ts")?.collapsed).toBe(false);
  });

  test("a list-only Review parses and shows only the file asked for", async () => {
    const hook = render(inputOf({ diff: diffOf("list-only") }));

    expect(hook.result.current.items).toEqual([]);

    act(() => revealInDiff("src/old.ts", 2));

    expect(hook.result.current.openFile).toBe("t1:src/old.ts");
    await waitFor(() =>
      expect(hook.result.current.items.map((i) => i.item.id)).toEqual(["t1:src/old.ts"])
    );
  });
});

describe("annotations", () => {
  test("findings and slot rows sit under their lines, each on its side", () => {
    const slot: ReviewAnnotation = {
      id: "thread-1",
      path: "src/serve.ts",
      side: "old",
      line: 2,
      render: () => null,
    };

    const hook = render(
      inputOf({
        annotations: [slot],
        findings: [
          {
            id: "f1",
            path: "src/serve.ts",
            lines: { start: 1, end: 2, side: "new" },
            severity: "critical",
            confidence: 1,
            title: "Port reuse",
            reason: "",
            status: "open",
          },
        ],
      })
    );

    const [serve] = hook.result.current.items;

    expect(
      serve?.item.type === "diff" &&
        serve.item.annotations?.map((a) => [a.side, a.lineNumber, a.metadata.kind])
    ).toEqual([
      ["additions", 2, "finding"],
      ["deletions", 2, "slot"],
    ]);
  });
});

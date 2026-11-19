import "../../../../test/dom.testing.ts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { filePatch, type FilePatch, TurnItem } from "@polaris/protocol";
import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../../store/store.ts";
import { completedItemView, liveItemView } from "../../model/items.ts";
import { Item } from "../items.tsx";

afterEach(cleanup);

type Change = { path: string; kind: "add" | "modify" | "delete"; patch?: FilePatch };

const fileChange = (changes: ReadonlyArray<Change>, extra: { writing?: boolean } = {}) =>
  TurnItem.cases.FileChange.make({
    id: "edit-1",
    changes,
    status: extra.writing === undefined ? "completed" : "running",
    ...extra,
  });

const lines = (count: number, word: string) =>
  Array.from({ length: count }, (_, i) => `const ${word}${i} = ${i};\n`).join("");

const InApp = ({ children }: { readonly children: ReactNode }) => {
  const store = createStore<AppState>(() => ({ ...initialState, theme: "light" }));

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  const navigation = createNavigation({ app: store, storage: null });
  const commands = createCommandRegistry({ platform: "mac" });

  return <AppProvider value={{ connection, navigation, commands }}>{children}</AppProvider>;
};

type FileChangeItem = Extract<TurnItem, { readonly _tag: "FileChange" }>;

const draw = (item: FileChangeItem, onOpenFile?: (path: string) => void, onOpenDiff = () => {}) =>
  render(
    <Item
      item={item.status === "running" ? liveView(item) : completedItemView(item)}
      hue="claude-code"
      onOpenDiff={onOpenDiff}
      onOpenFile={onOpenFile}
    />,
    { wrapper: InApp }
  );

const liveView = (item: FileChangeItem) => liveItemView(item.id, { item, text: "", output: "" });

const shownLines = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll("[data-line]")].map(
    (line) => `${line.getAttribute("data-line")} ${line.querySelector("code")?.textContent}`
  );

test("while its input streams, a Write shows as Writing and its file name, with no counts", () => {
  const view = draw(
    fileChange([{ path: "site/public/index.html", kind: "add" }], { writing: true })
  );

  expect(view.getByTestId("file-change").textContent).toContain("Writing index.html");
  expect(view.queryByTestId("counts")).toBeNull();
  expect(view.queryByText("writing")).toBeNull();
});

test("an edit shows its counts and up to 8 changed lines; Show all opens every line in place", () => {
  const before = `${lines(3, "keep")}${lines(10, "old")}${lines(3, "tail")}`;
  const after = `${lines(3, "keep")}${lines(10, "new")}${lines(3, "tail")}`;

  const view = draw(
    fileChange([{ path: "src/app.ts", kind: "modify", patch: filePatch(before, after) }])
  );

  expect(view.getByTestId("counts").textContent).toBe("+10−10");
  expect(shownLines(view)).toEqual(
    Array.from({ length: 8 }, (_, i) => `remove const old${i} = ${i};`)
  );

  fireEvent.click(view.getByRole("button", { name: "Show all 26 lines" }));

  const open = shownLines(view);

  expect(open).toHaveLength(26);
  expect(open[0]).toBe("context const keep0 = 0;");
  expect(open.at(-1)).toBe("context const tail2 = 2;");

  fireEvent.click(view.getByRole("button", { name: "Show fewer lines" }));
  expect(shownLines(view)).toHaveLength(8);
});

test("a Write that creates a file shows its first 8 lines as additions", () => {
  const view = draw(
    fileChange([{ path: "src/new.ts", kind: "add", patch: filePatch("", lines(20, "line")) }])
  );

  expect(view.getByTestId("counts").textContent).toBe("+20−0");
  expect(shownLines(view)).toEqual(
    Array.from({ length: 8 }, (_, i) => `add const line${i} = ${i};`)
  );
  expect(view.getByRole("button", { name: "Show all 20 lines" })).not.toBeNull();
});

test("a short edit shows every line with no Show all", () => {
  const view = draw(
    fileChange([
      { path: "a.ts", kind: "modify", patch: filePatch("const a = 1;\n", "const a = 2;\n") },
    ])
  );

  expect(shownLines(view)).toEqual(["remove const a = 1;", "add const a = 2;"]);
  expect(view.queryByRole("button", { name: /Show all/ })).toBeNull();
});

test("a truncated patch shows its counts only", () => {
  const patch = { diff: "", added: 4000, removed: 12, truncated: true };
  const view = draw(fileChange([{ path: "dist/bundle.js", kind: "modify", patch }]));

  expect(view.getByTestId("counts").textContent).toBe("+4000−12");
  expect(view.queryByTestId("file-patch")).toBeNull();
});

test("without a patch (a Daemon before file patches) a file is one row, writing while it runs", () => {
  const running = draw(
    TurnItem.cases.FileChange.make({
      id: "edit-1",
      changes: [{ path: "src/app.ts", kind: "modify" }],
      status: "running",
    })
  );

  expect(running.getByTestId("file-change").textContent).toBe("Msrc/app.tswriting");
  expect(running.queryByTestId("counts")).toBeNull();
  expect(running.queryByTestId("file-patch")).toBeNull();
});

test("a click on the path opens that file in Changes, or the Turn's diff where Changes isn't", () => {
  const opened: Array<string> = [];
  let diffs = 0;

  const item = fileChange([
    { path: "a.ts", kind: "modify", patch: filePatch("a\n", "b\n") },
    { path: "b.ts", kind: "modify", patch: filePatch("c\n", "d\n") },
  ]);

  const view = draw(item, (path) => opened.push(path));

  fireEvent.click(view.getByTitle("b.ts"));
  expect(opened).toEqual(["b.ts"]);

  cleanup();
  const bare = draw(item, undefined, () => diffs++);

  fireEvent.click(bare.getByTitle("a.ts"));
  expect(diffs).toBe(1);
});

test("several files each show their own patch, for a command that changed them", () => {
  const view = draw(
    fileChange([
      { path: "a.ts", kind: "modify", patch: filePatch("x\n", "y\n") },
      { path: "old.ts", kind: "delete", patch: filePatch("gone\n", "") },
    ])
  );

  expect(view.getAllByTestId("file-change-row")).toHaveLength(2);
  expect(shownLines(view)).toEqual(["remove x", "add y", "remove gone"]);
});

test("changed lines are coloured by the Editor's syntax tokens", () => {
  const view = draw(
    fileChange([
      { path: "a.ts", kind: "modify", patch: filePatch("", 'export const name = "polaris";\n') },
    ])
  );

  const colours = [...view.container.querySelectorAll<HTMLElement>("[data-line] code span")].map(
    (span) => span.style.color
  );

  expect(colours).toContain("var(--color-syntax-keyword)");
  expect(colours).toContain("var(--color-syntax-string)");
});

test("open, separate hunks have a gap between them and a missing final newline says so", () => {
  const before = `${lines(30, "a")}tail`;
  const after = `${lines(30, "a").replace("a0 = 0", "a0 = 9").replace("a29 = 29", "a29 = 7")}tail2`;

  const view = draw(
    fileChange([{ path: "a.ts", kind: "modify", patch: filePatch(before, after) }])
  );

  fireEvent.click(view.getByRole("button", { name: /Show all/ }));
  const patch = view.getByTestId("file-patch").textContent ?? "";

  expect(patch).toContain("⋯");
  expect(patch).toContain("No newline at end of file");
});

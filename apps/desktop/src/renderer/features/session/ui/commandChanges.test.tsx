import "../../../test/dom.testing.ts";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { filePatch, type ItemFileChange, TurnItem } from "@polaris/protocol";
import { afterEach, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { AppProvider } from "../../../shell/hooks.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { completedItemView, liveItemView } from "../model/items.ts";
import { Item } from "./items.tsx";

afterEach(cleanup);

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

let ids = 0;

const command = (
  changes: ReadonlyArray<ItemFileChange> | undefined,
  extra: { readonly moreChanges?: number; readonly status?: "running" | "completed" } = {}
) => {
  const plain = TurnItem.cases.CommandExecution.make({
    // Each test its own id: the fold is remembered by item.
    id: `call-${++ids}`,
    command: "python3 - <<'EOF'",
    cwd: "/w",
    output: "",
    exitCode: extra.status === "running" ? null : 0,
    status: extra.status ?? "completed",
  });

  if (changes === undefined) return plain;
  const changed = TurnItem.cases.CommandExecution.make({ ...plain, changes });

  return extra.moreChanges === undefined
    ? changed
    : TurnItem.cases.CommandExecution.make({ ...changed, moreChanges: extra.moreChanges });
};

const draw = (
  item: ReturnType<typeof command>,
  handlers: { onOpenFile?: (path: string) => void; onOpenDiff?: () => void } = {}
) =>
  render(
    <Item
      item={
        item.status === "running"
          ? liveItemView(item.id, { item, text: "", output: "" })
          : completedItemView(item)
      }
      hue="claude-code"
      onOpenDiff={handlers.onOpenDiff ?? (() => {})}
      onOpenFile={handlers.onOpenFile}
    />,
    { wrapper: InApp }
  );

const names = (count: number): Array<ItemFileChange> =>
  Array.from({ length: count }, (_, i) => ({ path: `/w/out/f${i}.txt`, kind: "add" }));

test("a finished command shows Changed 2 files, each with its counts and changed lines", () => {
  const opened: Array<string> = [];

  const view = draw(
    command([
      {
        path: "/w/src/app.py",
        kind: "modify",
        patch: filePatch("def answer():\n    return 1\n", "def answer():\n    return 2\n"),
      },
      { path: "/w/notes.txt", kind: "add", patch: filePatch("", "hello\n") },
    ]),
    { onOpenFile: (path) => opened.push(path) }
  );

  const block = view.getByTestId("command-changes");

  expect(block.textContent).toContain("Changed 2 files");
  expect([...block.querySelectorAll("[data-testid=counts]")].map((c) => c.textContent)).toEqual([
    "+1−1",
    "+1−0",
  ]);
  expect(
    [...block.querySelectorAll("[data-line]")].map(
      (line) => `${line.getAttribute("data-line")} ${line.querySelector("code")?.textContent}`
    )
  ).toEqual(["remove     return 1", "add     return 2", "add hello"]);

  fireEvent.click(view.getByTitle("/w/notes.txt"));
  expect(opened).toEqual(["/w/notes.txt"]);
});

test("a command shows no changes while it runs, nor when the Daemon reported none", () => {
  expect(
    draw(command(names(1), { status: "running" })).queryByTestId("command-changes")
  ).toBeNull();
  cleanup();
  expect(draw(command(undefined)).queryByTestId("command-changes")).toBeNull();
  cleanup();
  expect(draw(command([])).queryByTestId("command-changes")).toBeNull();
});

test("one changed file reads Changed 1 file", () => {
  const view = draw(command(names(1)));

  expect(view.getByTestId("command-changes").textContent).toContain("Changed 1 file");
  expect(view.getByTestId("command-changes").textContent).not.toContain("Changed 1 files");
});

test("many files fold to 8; Show all lists them, and the uncounted rest opens the turn's changes", () => {
  let diffs = 0;
  const view = draw(command(names(12), { moreChanges: 1030 }), { onOpenDiff: () => diffs++ });

  expect(view.getByTestId("command-changes").textContent).toContain("Changed 1,042 files");
  expect(view.getAllByTestId("file-change-row")).toHaveLength(8);
  expect(view.queryByText(/more in this turn's changes/)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Show all 12 files" }));
  expect(view.getAllByTestId("file-change-row")).toHaveLength(12);

  fireEvent.click(view.getByRole("button", { name: "and 1,030 more in this turn's changes" }));
  expect(diffs).toBe(1);

  fireEvent.click(view.getByRole("button", { name: "Show fewer files" }));
  expect(view.getAllByTestId("file-change-row")).toHaveLength(8);
});

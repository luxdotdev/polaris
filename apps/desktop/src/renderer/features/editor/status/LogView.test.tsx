import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { workspaceKey } from "../model/drafts.ts";
import { editorStore } from "../runtime/store.ts";
import { contextObserved } from "./feed.ts";
import { checkout, context, HOST, running, runtimes, workspaceId } from "./fixtures.testing.ts";
import { appendLogLines, appendStderr, LOG_LIMIT, logKey, logStore, type LogScope } from "./log.ts";
import { copyText, matchParts, visibleLines } from "./logModel.ts";
import { closeLogTab, logTabStore, openLanguageLog } from "./logTabs.ts";
import { LogView } from "./LogView.tsx";

const scope: LogScope = { hostKey: HOST, checkout, providerId: "typescript-language-server" };

const at = new Date(2026, 9, 7, 14, 5, 40, 117).getTime();

const lines = [
  {
    at,
    level: "info" as const,
    text: "Starting typescript-language-server",
    origin: "feed" as const,
  },
  { at, level: "warning" as const, text: "Skipped tsconfig plugin", origin: "feed" as const },
  { at, level: "error" as const, text: "Error: Debug Failure", origin: "feed" as const },
  { at, level: "error" as const, text: "    at checkDecoratorLowering", origin: "feed" as const },
];

beforeEach(() => {
  logStore.setState({ logs: {} });
  logTabStore.setState({ workspaces: {} });
});

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

describe("the log store", () => {
  test("a stopped server's stderr folds in once per tail", () => {
    appendStderr(scope, "FATAL ERROR\nAllocation failed\n", at);
    appendStderr(scope, "FATAL ERROR\nAllocation failed\n", at);

    expect(logStore.getState().logs[logKey(scope)]?.lines.map((line) => line.text)).toEqual([
      "FATAL ERROR",
      "Allocation failed",
    ]);
  });

  test("context events become lines: Log events and a crash's stderr", () => {
    contextObserved(
      HOST,
      P.LanguageContextEvent.cases.Log.make({
        context: context(),
        level: "warning",
        message: "Language server wrote stderr; private output withheld",
      })
    );
    contextObserved(
      HOST,
      P.LanguageContextEvent.cases.RuntimeChanged.make({
        context: context(),
        runtime: runtimes.crashed("boom"),
      })
    );

    expect(
      logStore
        .getState()
        .logs[logKey(scope)]?.lines.map((line) => [line.level, line.text, line.origin])
    ).toEqual([
      ["warning", "Language server wrote stderr; private output withheld", "event"],
      ["error", "boom", "stderr"],
    ]);
    expect(running(runtimes.ready).context.providerId).toBe(scope.providerId);
  });

  test("the log keeps its newest lines within the bound", () => {
    appendLogLines(
      scope,
      Array.from({ length: LOG_LIMIT + 5 }, (_, index) => ({
        at,
        level: "info" as const,
        text: `line ${index}`,
        origin: "feed" as const,
      }))
    );
    const log = logStore.getState().logs[logKey(scope)];

    expect(log?.lines).toHaveLength(LOG_LIMIT);
    expect(log?.dropped).toBe(5);
    expect(log?.lines[0]?.text).toBe("line 5");
  });
});

describe("the log model", () => {
  test("counts filter, find narrows, copy keeps time and level", () => {
    expect(visibleLines(lines, { only: new Set(["error"]), query: "" })).toHaveLength(2);
    expect(visibleLines(lines, { only: new Set(["error", "warning"]), query: "" })).toHaveLength(3);
    expect(visibleLines(lines, { only: new Set(), query: "DEBUG" })).toHaveLength(1);
    expect(copyText(lines.slice(2, 3))).toBe("14:05:40.117 error Error: Debug Failure");
    expect(matchParts("a Debug b debug", "debug")).toEqual([
      { text: "a ", match: false },
      { text: "Debug", match: true },
      { text: " b ", match: false },
      { text: "debug", match: true },
    ]);
  });
});

describe("the log tab", () => {
  const view = () => within(document.body);

  test("toolbar counts are filters; Find, Wrap, Follow and Copy all work", async () => {
    appendLogLines(scope, lines);
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    render(
      <LogView
        scope={scope}
        server="typescript-language-server 6.0.1"
        detail="bundled TypeScript 6.0.3"
      />
    );

    expect(view().getByText(/4 lines/)).toBeTruthy();
    expect(view().getAllByRole("listitem")).toHaveLength(4);

    fireEvent.click(view().getByText("2 errors"));
    expect(
      view()
        .getAllByRole("listitem")
        .map((item) => item.dataset.level)
    ).toEqual(["error", "error"]);
    expect(view().getByText("2 errors").closest("button")?.getAttribute("aria-pressed")).toBe(
      "true"
    );

    fireEvent.click(view().getByText("2 errors"));
    fireEvent.click(view().getByText("Find ⌘F"));
    const find = view().getByLabelText("Find in log");
    // happy-dom lacks `oninput`, so React watches the focused field's value on key events.
    act(() => find.focus());
    fireEvent.change(find, { target: { value: "plugin" } });
    fireEvent.keyUp(find, { key: "n" });
    expect(view().getAllByRole("listitem")).toHaveLength(1);
    expect(view().getByText("plugin").tagName).toBe("MARK");

    fireEvent.click(view().getByText("Wrap"));
    expect(view().getByText("Wrap").closest("button")?.getAttribute("aria-pressed")).toBe("true");

    const follow = view().getByText("Follow").closest("button");
    expect(follow?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(follow!);
    expect(follow?.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(view().getByText("Copy all"));
    await view().findByText("Copied");
    expect(written).toEqual(["14:05:40.117 warn Skipped tsconfig plugin"]);
  });

  test("an empty log says lines appear as the server writes them", () => {
    render(<LogView scope={scope} server="typescript-language-server" detail={null} />);

    expect(view().getByText(/Nothing logged yet/)).toBeTruthy();
    act(() => appendLogLines(scope, lines.slice(0, 1)));
    expect(view().getAllByRole("listitem")).toHaveLength(1);
  });

  test("one tab per server; opening a file shows the file again; closing returns to files", () => {
    const key = workspaceKey(HOST, workspaceId);
    editorStore.setState({
      tabs: {
        [key]: {
          tabs: [{ path: "/code/polaris/a.ts", preview: false }],
          active: "/code/polaris/a.ts",
        },
      },
    });

    openLanguageLog(scope, "TypeScript");
    openLanguageLog(scope, "TypeScript");
    const logs = logTabStore.getState().workspaces[key];

    expect(logs?.tabs).toHaveLength(1);
    expect(logs?.active).toBe(logs?.tabs[0]?.id ?? "missing");

    editorStore.setState({
      tabs: {
        [key]: {
          tabs: [{ path: "/code/polaris/a.ts", preview: false }],
          active: "/code/polaris/a.ts",
        },
      },
    });
    expect(logTabStore.getState().workspaces[key]?.active).toBeNull();

    openLanguageLog(scope, "TypeScript");
    closeLogTab(HOST, workspaceId, logs?.tabs[0]?.id ?? "");
    expect(logTabStore.getState().workspaces[key]).toEqual({ tabs: [], active: null });
  });
});

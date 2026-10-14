import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CopyProvider } from "@polaris/ui";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { workspaceKey } from "../model/drafts.ts";
import { editorStore } from "../runtime/store.ts";
import { contextObserved, watchServerLog } from "./feed.ts";
import type { LanguageApi } from "../../../../shared/api.ts";
import { checkout, context, HOST, runtimes, workspaceId } from "./fixtures.testing.ts";
import { appendLogLines, appendStderr, LOG_LIMIT, logKey, logStore, type LogScope } from "./log.ts";
import { copyText, matchParts, visibleLines } from "./logModel.ts";
import { closeLogTab, logTabStore, showLogTab } from "./logTabs.ts";
import { canOpenLanguageLog, openLanguageLog } from "../intents/languageLog.ts";
import "./intent.ts";
import { statusOpened, statusDiscovered, statusStore } from "./store.ts";
import { fileKey } from "../model/drafts.ts";
import { eligible } from "./fixtures.testing.ts";
import { LogView } from "./LogView.tsx";
import { standInBridge } from "../../bridge.ts";
import { setClientPlatform } from "../../../../shared/platform.ts";

// These tests read macOS labels ("⌘↵", "⌃Space").
beforeAll(() => setClientPlatform("darwin"));

afterAll(() => setClientPlatform(null));

beforeEach(() => standInBridge(null));

const written: string[] = [];

const record = async (text: string) => {
  written.push(text);

  return true;
};

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

  test("the live feed: backlog then lines, each once, across a restart; crash stderr after", () => {
    const listeners: ((items: readonly object[]) => void)[] = [];
    const subscribed: object[] = [];

    const api: LanguageApi = {
      request: async () => ({ ok: false, error: { code: "unused", message: "unused" } }),
      subscribe: (_kind, input, listener) => {
        subscribed.push(input);
        // SAFETY: this test only subscribes to languages.log.watch, whose items it builds.
        listeners.push(listener.items as (items: readonly object[]) => void);

        return () => undefined;
      },
    };

    const line = (sequence: number, text: string, level: "info" | "error" = "info") => ({
      sequence,
      time: at,
      level,
      source: "logMessage" as const,
      text,
    });

    const first = context(1);
    watchServerLog(api, HOST, first);
    listeners[0]?.([
      P.LanguageServerLogEvent.cases.Snapshot.make({
        context: first,
        lines: [line(1, "Starting"), line(2, "Project loaded")],
      }),
    ]);
    listeners[0]?.([
      P.LanguageServerLogEvent.cases.Line.make({ context: first, line: line(3, "didOpen") }),
    ]);

    // Subscribing again to the same generation repeats its backlog; nothing doubles.
    watchServerLog(api, HOST, first);
    listeners[1]?.([
      P.LanguageServerLogEvent.cases.Snapshot.make({
        context: first,
        lines: [line(1, "Starting"), line(2, "Project loaded"), line(3, "didOpen")],
      }),
    ]);

    const second = context(2);
    watchServerLog(api, HOST, second);
    listeners[2]?.([
      P.LanguageServerLogEvent.cases.Snapshot.make({
        context: second,
        lines: [line(1, "Restarted")],
      }),
    ]);
    contextObserved(
      HOST,
      P.LanguageContextEvent.cases.RuntimeChanged.make({
        context: second,
        runtime: runtimes.crashed("boom"),
      })
    );

    expect(subscribed[0]).toEqual({ hostKey: HOST, context: first });
    expect(
      logStore.getState().logs[logKey(scope)]?.lines.map((value) => [value.text, value.origin])
    ).toEqual([
      ["Starting", "feed"],
      ["Project loaded", "feed"],
      ["didOpen", "feed"],
      ["Restarted", "feed"],
      ["boom", "stderr"],
    ]);
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
    written.length = 0;
    render(
      <CopyProvider write={record}>
        <LogView
          scope={scope}
          server="typescript-language-server 6.0.1"
          detail="bundled TypeScript 6.0.3"
        />
      </CopyProvider>
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

    const copyAll = view().getByRole("button", { name: "Copy all" });

    fireEvent.click(copyAll);
    await waitFor(() => expect(copyAll.getAttribute("data-copy-state")).toBe("copied"));
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

    showLogTab(scope, "TypeScript");
    showLogTab(scope, "TypeScript");
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

    showLogTab(scope, "TypeScript");
    closeLogTab(HOST, workspaceId, logs?.tabs[0]?.id ?? "");
    expect(logTabStore.getState().workspaces[key]).toEqual({ tabs: [], active: null });
  });

  test("the palette's intent opens the file's first server's log, once", () => {
    const key = workspaceKey(HOST, workspaceId);
    const path = "/code/polaris/a.ts";
    statusStore.setState({ files: {}, runtimes: {}, hosts: {} });
    statusOpened(fileKey(HOST, path), HOST, path);
    statusDiscovered(fileKey(HOST, path), {
      checkout,
      projectRoot: "/code/polaris",
      providers: [eligible()],
      effectiveSettings: {
        revision: 0,
        formatOnSave: true,
        formatter: P.LanguageFormatterSelection.cases.None.make({}),
        providers: [],
        settings: {},
        origins: {},
      },
      trust: P.LanguageTrust.make({
        scope: P.LanguageTrustScope.cases.Workspace.make({
          hostId: P.HostId.make("host-1"),
          workspaceId,
        }),
        revision: 1,
        trusted: false,
      }),
    });

    const intent = {
      hostKey: HOST,
      workspaceId,
      checkout,
      language: "typescript" as const,
      providerId: null,
      path,
    };

    expect(canOpenLanguageLog()).toBe(true);
    expect(openLanguageLog(intent)).toBe(true);
    expect(openLanguageLog(intent)).toBe(true);

    const logs = logTabStore.getState().workspaces[key];

    expect(logs?.tabs.map((tab) => [tab.language, tab.scope.providerId])).toEqual([
      ["TypeScript", "typescript-language-server"],
    ]);
    expect(logs?.active).toBe(logs?.tabs[0]?.id ?? "missing");
  });
});

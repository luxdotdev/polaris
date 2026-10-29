import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CopyProvider } from "@polaris/ui";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { standInBridge } from "../../bridge.ts";
import * as P from "@polaris/protocol";
import type { IpcError, LanguageApi } from "../../../../shared/api.ts";
import { Schema } from "effect";
import { trustStore } from "../trust/store.ts";
import { runAction } from "./actions.ts";
import {
  checkout,
  context,
  HOST,
  input,
  running,
  runtimes,
  trust,
  TS,
} from "./fixtures.testing.ts";
import { actionFailure, LanguagePill, StatusPopover, withIndentation } from "./LanguageStatus.tsx";
import { statusView, type StatusAction } from "./model.ts";
import { runtimeKey, statusStore } from "./store.ts";

const written: string[] = [];

const record = async (text: string) => {
  written.push(text);

  return true;
};

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

beforeEach(() => standInBridge(null));

test("an unchanged prerequisite retry announces its completed check", () => {
  render(
    <StatusPopover
      view={statusView(input())}
      running={null}
      failure={null}
      feedback="Still not found. Checked standard Host locations."
      onRun={() => {}}
      titleId="checked"
    />
  );
  expect(within(document.body).getByRole("status").textContent).toContain("Still not found");
});

const screen = () => within(document.body);

const popover = (
  view: ReturnType<typeof statusView>,
  onRun: (action: StatusAction) => void = () => undefined
) =>
  render(
    <CopyProvider write={record}>
      <StatusPopover view={view} running={null} failure={null} onRun={onRun} titleId="title" />
    </CopyProvider>
  );

describe("the pill", () => {
  test("renders the view's kind, words and mark", () => {
    render(<LanguagePill view={statusView(input({ runtimes: [running(runtimes.crashed())] }))} />);
    const pill = screen().getByTestId("language-pill");

    expect(pill.dataset.kind).toBe("crashed");
    expect(pill.textContent).toBe("TypeScript · stopped");
    expect(pill.querySelector("[data-mark]")?.getAttribute("data-mark")).toBe("failed");
  });

  test("syntax only has no mark", () => {
    render(<LanguagePill view={statusView(input({ file: null, runtimes: [] }))} />);

    expect(screen().getByTestId("language-pill").querySelector("[data-mark]")).toBeNull();
  });
});

describe("the popover", () => {
  test("lists the file's indentation, where it stays when the status row drops it", () => {
    popover(withIndentation(statusView(input()), "Tabs 4"), () => undefined);

    const row = screen().getByText("Indentation").parentElement;

    expect(row?.textContent).toBe("IndentationTabs 4");
  });

  test("stopped: stderr in mono, and rows that run", () => {
    const ran: string[] = [];
    popover(statusView(input({ runtimes: [running(runtimes.crashed())] })), (action) =>
      ran.push(action.id)
    );

    expect(screen().getByText("Allocation failed").tagName).toBe("PRE");
    fireEvent.click(screen().getByText("Restart TypeScript server"));
    fireEvent.click(screen().getByText("Show language server log"));
    expect(ran).toEqual(["restart", "show-log"]);
  });

  test("a Prerequisite's command copies", async () => {
    written.length = 0;
    popover(
      statusView({
        ...input(),
        language: "Python",
        runtimes: [],
        file: {
          ...input().file!,
          contexts: {},
          providers: [
            {
              providerId: "basedpyright",
              preflight: P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
              launch: null,
              prerequisites: [
                {
                  requirement: {
                    id: "python",
                    scope: "project",
                    executable: "/usr/bin/python3",
                    version: ">=3.9",
                    detail: "",
                    required: true,
                    installCommands: [
                      {
                        platforms: [{ os: "darwin", arch: "arm64", libc: "none" }],
                        label: "uv",
                        command: "uv python install 3.13",
                      },
                    ],
                  },
                  effectiveExecutable: null,
                  detectedVersion: null,
                  outcome: "missing",
                  reason: "No python3.",
                },
              ],
            },
          ],
        },
      })
    );

    expect(screen().getByText("Run on Mac Studio")).toBeTruthy();
    expect(screen().getByText("uv")).toBeTruthy();
    const copy = screen().getByRole("button", { name: "Copy" });

    fireEvent.click(copy);
    await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("copied"));
    expect(written).toEqual(["uv python install 3.13"]);
  });

  test("a failed action reads inline, chosen by its typed reason", () => {
    render(
      <StatusPopover
        view={statusView(input())}
        running={{ id: "restart" }}
        failure={actionFailure(
          new P.LanguageError({ reason: "not-connected", message: "x", retryable: true }),
          "Mac Studio"
        )}
        onRun={() => undefined}
        titleId="t"
      />
    );

    expect(screen().getByRole("alert").textContent).toBe(
      "Can't reach Mac Studio. Try again when it's back."
    );
    expect(
      screen().getByText("Restart TypeScript server").closest("button")?.getAttribute("aria-busy")
    ).toBe("true");
  });
});

describe("popover actions", () => {
  interface Call {
    readonly method: string;
    readonly input: object | null;
  }

  type Answer =
    | { readonly ok: true; readonly value: object | null }
    | { readonly ok: false; readonly error: IpcError };

  const calls: Call[] = [];

  const api = (reply: () => Answer): LanguageApi => ({
    request: async (method, input) => {
      calls.push({ method, input });

      // SAFETY: each test answers with the shape the method returns over IPC.
      return reply() as never;
    },
    subscribe: () => () => undefined,
  });

  const ports = (value: LanguageApi) => ({
    api: value,
    recheck: async () => {
      calls.push({ method: "recheck", input: null });
    },
    showLog: () => calls.push({ method: "show-log", input: null }),
    openSettings: () => calls.push({ method: "settings", input: null }),
  });

  const target = {
    hostKey: HOST,
    path: "/code/polaris/a.ts",
    checkout,
    providerId: TS,
    trust: trust("declined", "bundled"),
  };

  test("Restart calls the server restart RPC and folds its snapshot", async () => {
    calls.length = 0;

    const snapshot = {
      context: context(2),
      runtime: runtimes.starting,
      ack: { context: context(2), acceptedSequence: 0, documents: [] },
      limits: {
        messageBytes: 1,
        queuedMessages: 1,
        outstandingRequests: 1,
        documents: 1,
        diagnosticsPerDocument: 1,
        logBytes: 1,
        requestTimeoutMs: 1,
      },
    };

    await runAction("restart", target, ports(api(() => ({ ok: true, value: [snapshot] }))));

    expect(calls).toEqual([
      {
        method: "languages.server.restart",
        input: { hostKey: HOST, checkout, providerId: TS },
      },
    ]);
    expect(statusStore.getState().runtimes[runtimeKey(HOST, "editor-ctx-1")]?.runtime).toEqual(
      runtimes.starting
    );
  });

  test("Trust asks again with the known revision, so the Trust card returns", async () => {
    calls.length = 0;
    const answer = trust("undecided", "bundled");
    await runAction(
      "trust",
      target,
      ports(api(() => ({ ok: true, value: { ...answer, ask: true } })))
    );

    expect(calls[0]).toEqual({
      method: "languages.trust.change",
      input: {
        hostKey: HOST,
        checkout,
        path: target.path,
        action: "ask-again",
        expectedRevision: 4,
      },
    });
    expect(Object.keys(trustStore.getState().asks)).toHaveLength(1);
  });

  test("a refused restart rejects with the typed error", async () => {
    const refused = api(() => ({
      ok: false,
      error: {
        code: "language",
        message: "nope",
        languageError: Schema.encodeSync(P.LanguageError)(
          new P.LanguageError({ reason: "not-owner", message: "nope", retryable: false })
        ),
      },
    }));

    const error = await runAction("restart", target, ports(refused)).then(
      () => null,
      (value: P.LanguageError) => value
    );

    expect(error).toBeInstanceOf(P.LanguageError);
    expect(error?.reason).toBe("not-owner");
  });

  test("local rows never call the Daemon", async () => {
    calls.length = 0;
    const value = api(() => ({ ok: true, value: null }));

    await runAction("show-log", target, ports(value));
    await runAction("settings", target, ports(value));
    await runAction("check-again", target, ports(value));

    expect(calls.map((call) => call.method)).toEqual(["show-log", "settings", "recheck"]);
  });
});

test("repeated failure appears once and never exposes a raw transport placeholder", () => {
  const view = statusView(
    input({
      file: {
        ...input().file!,
        phase: "failed",
        failure: { reason: "server-failed", message: "Language operation: server-failed" },
      },
      runtimes: [],
    })
  );

  const failure = actionFailure(
    new P.LanguageError({
      reason: "server-failed",
      message: "Language operation: server-failed",
      retryable: true,
    }),
    "lucas-rpi"
  );

  render(
    <StatusPopover
      view={view}
      running={null}
      failure={failure}
      onRun={() => undefined}
      titleId="t"
    />
  );
  expect(document.body.textContent).not.toContain("Language operation:");
  expect(screen().queryByRole("alert")).toBeNull();
  expect(screen().getAllByText(/couldn't start or stopped responding/)).toHaveLength(1);
  expect(screen().getByText("Restart TypeScript server")).toBeTruthy();
  expect(screen().getByText("Show language server log")).toBeTruthy();
});

test("a failed check with no context restarts by discovering again", async () => {
  let rechecked = 0;
  await runAction(
    "restart",
    { hostKey: HOST, path: "/code/a.ts", checkout, providerId: null, trust: null },
    {
      api: {
        request: async () => {
          throw new Error("No server context exists");
        },
        subscribe: () => () => undefined,
      },
      recheck: async () => {
        rechecked++;
      },
      showLog: () => undefined,
      openSettings: () => undefined,
    }
  );
  expect(rechecked).toBe(1);
});

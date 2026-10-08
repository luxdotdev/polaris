import "../../../test/dom.testing.ts";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
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
import { actionFailure, LanguagePill, StatusPopover } from "./LanguageStatus.tsx";
import { statusView, type StatusAction } from "./model.ts";
import { runtimeKey, statusStore } from "./store.ts";

// Another DOM test file may have unregistered happy-dom already.
beforeAll(() => {
  if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
});

afterEach(cleanup);

const screen = () => within(document.body);

const popover = (
  view: ReturnType<typeof statusView>,
  onRun: (action: StatusAction) => void = () => undefined
) =>
  render(<StatusPopover view={view} running={null} failure={null} onRun={onRun} titleId="title" />);

describe("the pill", () => {
  test.each([
    ["ready", input({ trust: trust("trusted", "project") }), "filled", "TypeScript"],
    ["bundled", input({ trust: trust("declined", "bundled") }), "hollow", "TypeScript · bundled"],
    [
      "crashed",
      input({ runtimes: [running(runtimes.crashed())] }),
      "failed",
      "TypeScript · stopped",
    ],
  ])("%s", (kind, value, mark, text) => {
    render(<LanguagePill view={statusView(value)} />);
    const pill = screen().getByTestId("language-pill");

    expect(pill.dataset.kind).toBe(kind);
    expect(pill.textContent).toBe(text);
    expect(pill.querySelector("[data-mark]")?.getAttribute("data-mark")).toBe(mark);
  });

  test("syntax only has no mark", () => {
    render(<LanguagePill view={statusView(input({ file: null, runtimes: [] }))} />);

    expect(screen().getByTestId("language-pill").querySelector("[data-mark]")).toBeNull();
  });
});

describe("the popover", () => {
  test("ready: sentence, facts and the action rows in order", () => {
    popover(statusView(input({ trust: trust("trusted", "project") })));

    expect(screen().getByRole("heading").textContent).toBe("TypeScript is ready");
    expect(screen().getByText("7.0.2")).toBeTruthy();
    expect(
      screen()
        .getAllByRole("menuitem")
        .map((item) => item.textContent)
    ).toEqual([
      "Restart TypeScript server",
      "Use bundled TypeScript6.0.3",
      "Show language server log",
      "Language settings…",
    ]);
  });

  test("stopped: the failed title, stderr in mono, and rows that run", () => {
    const ran: string[] = [];
    popover(statusView(input({ runtimes: [running(runtimes.crashed())] })), (action) =>
      ran.push(action.id)
    );

    expect(screen().getByRole("heading").className).toContain("text-failed-text");
    expect(screen().getByText(/FATAL ERROR/).tagName).toBe("PRE");
    fireEvent.click(screen().getByText("Restart TypeScript server"));
    fireEvent.click(screen().getByText("Show language server log"));
    expect(ran).toEqual(["restart", "show-log"]);
  });

  test("a Prerequisite's command copies", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
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
    fireEvent.click(screen().getByText("Copy"));
    await screen().findByText("Copied");
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

import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import type { IpcError, LanguageApi } from "../../../../shared/api.ts";
import type { EditorFile } from "../api.ts";
import type { FormatSnapshot } from "./index.ts";
import { formatRoute, formatWithProject, projectFormattedText } from "./project.ts";

const None = P.LanguageFormatterSelection.cases.None.make({});

const oxfmt = (patch: Partial<P.LanguageProjectFormatter> = {}) =>
  P.LanguageProjectFormatter.make({
    tool: "oxfmt",
    root: "/code/polaris",
    config: "/code/polaris/oxfmt.config.mts",
    installed: true,
    ignored: false,
    ...patch,
  });

describe("routing", () => {
  test.each([
    ["no project formatter: the language server", None, null, "server"],
    ["an old Daemon reports none: the language server", None, undefined, "server"],
    ["the project's formatter, automatically", None, oxfmt(), "project"],
    ["the project's ignore files exclude the file", None, oxfmt({ ignored: true }), "ignored"],
    [
      "a formatter chosen in Settings overrides the project's",
      P.LanguageFormatterSelection.cases.Provider.make({
        providerId: "typescript-language-server",
      }),
      oxfmt(),
      "server",
    ],
  ] as const)("%s", (_name, formatter, project, route) => {
    expect(formatRoute(formatter, project)).toBe(route);
  });
});

const file: EditorFile = {
  hostKey: "host-1",
  workspaceId: "ws-1",
  path: "/code/polaris/apps/daemon/src/main.ts",
};

const snapshot = (patch: Partial<FormatSnapshot> = {}): FormatSnapshot => ({
  file,
  text: "export { };\n",
  version: 12,
  diskVersion: null,
  reason: "manual",
  ...patch,
});

describe("version fence", () => {
  const formatted = (requestId: string, version: number) =>
    P.LanguageProjectFormatOutcome.cases.Formatted.make({
      requestId,
      version,
      tool: "oxfmt",
      text: "export {};\n",
    });

  test("applies only this request's answer for this buffer version", () => {
    expect(projectFormattedText(formatted("r1", 12), "r1", snapshot())).toBe("export {};\n");
    expect(() => projectFormattedText(formatted("r1", 11), "r1", snapshot())).toThrow(
      "Formatter document changed."
    );
    expect(() => projectFormattedText(formatted("r0", 12), "r1", snapshot())).toThrow(
      "Formatter document changed."
    );
  });

  test("skipped keeps the text; failed explains", () => {
    const skipped = P.LanguageProjectFormatOutcome.cases.Skipped.make({
      requestId: "r1",
      version: 12,
      reason: "ignored",
    });

    const failed = P.LanguageProjectFormatOutcome.cases.Failed.make({
      requestId: "r1",
      reason: "formatter-failed",
      message: "Expected `}` but found `EOF`",
    });

    expect(projectFormattedText(skipped, "r1", snapshot())).toBe("export { };\n");
    expect(() => projectFormattedText(failed, "r1", snapshot())).toThrow(
      "Expected `}` but found `EOF`."
    );
  });
});

const target = {
  hostKey: "host-1",
  checkout: P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("ws-1"),
    path: "/code/polaris",
  }),
  path: file.path,
  tool: "oxfmt",
  workspace: "polaris",
};

const daemon = (
  answer: (input: P.LanguageProjectFormatInput) => P.LanguageProjectFormatOutcome | null,
  error?: IpcError
) => {
  const calls: string[] = [];

  const api: LanguageApi = {
    request: async (method, input) => {
      calls.push(method);

      if (error !== undefined) return { ok: false, error };

      // SAFETY: the only method this fake answers is languages.format.project.
      return { ok: true, value: answer(input as P.LanguageProjectFormatInput) as never };
    },
    subscribe: () => () => undefined,
  };

  return { api, calls };
};

const awaitingTrust: IpcError = {
  code: "LanguageError",
  message: "Checkout execution requires trust",
  languageError: new P.LanguageError({
    reason: "awaiting-trust",
    message: "Checkout execution requires trust",
    retryable: false,
  }),
};

const failure = (promise: Promise<string>) =>
  promise.then(
    () => null,
    (error: Error) => error.message
  );

describe("running the project's formatter", () => {
  test("trusted: the Daemon's text, echoed for this version", async () => {
    const f = daemon((input) =>
      P.LanguageProjectFormatOutcome.cases.Formatted.make({
        requestId: input.requestId,
        version: input.version,
        tool: "oxfmt",
        text: input.text.replace("{ }", "{}"),
      })
    );

    expect(await formatWithProject(f.api, target, snapshot(), new AbortController().signal)).toBe(
      "export {};\n"
    );
    expect(f.calls).toEqual(["languages.format.project"]);
  });

  test("untrusted save keeps the text as typed, never the server's style", async () => {
    const f = daemon(() => null, awaitingTrust);

    expect(await formatWithProject(f.api, target, snapshot(), new AbortController().signal)).toBe(
      "export { };\n"
    );
  });

  test("untrusted Format document explains instead", async () => {
    const f = daemon(() => null, awaitingTrust);

    expect(
      await failure(
        formatWithProject(f.api, target, snapshot({ command: true }), new AbortController().signal)
      )
    ).toBe("Formatting uses oxfmt once you trust polaris.");
  });

  test("other failures surface", async () => {
    const f = daemon(() => null, { code: "NotConnected", message: "Host is offline" });

    expect(
      await failure(formatWithProject(f.api, target, snapshot(), new AbortController().signal))
    ).toBe("Host is offline");
  });
});

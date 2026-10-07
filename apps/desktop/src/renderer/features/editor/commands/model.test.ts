import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import type { TrustStatus } from "../trust/model.ts";
import { type FocusedFile, fileContext, trustFollowUp, typescriptFollowUp } from "./model.ts";

const hostId = P.HostId.make("host-1");

const workspaceId = P.WorkspaceId.make("ws-1");

type Decision = "undecided" | "trusted" | "declined";

const status = (
  decision: Decision,
  options: { readonly version?: string | null; readonly review?: boolean } = {}
): TrustStatus =>
  P.LanguageTrustStatus.make({
    trust: P.LanguageTrust.make({
      scope: options.review
        ? P.LanguageTrustScope.cases.ReviewCheckout.make({
            hostId,
            workspaceId,
            reviewCheckoutId: P.ReviewCheckoutId.make("r-1"),
          })
        : P.LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId }),
      revision: 3,
      trusted: decision === "trusted",
      decision,
    }),
    wouldRun: {
      typescriptVersion: options.version === undefined ? "7.0.2" : options.version,
      typescriptPath: null,
      native: true,
      plugins: [],
    },
    ask: false,
    provider: decision === "trusted" ? "project" : "bundled",
  });

const file = (patch: Partial<FocusedFile> = {}): FocusedFile => ({
  path: "/code/polaris/daemon/src/hosts/reconnect.ts",
  language: "typescript",
  providers: ["typescript-language-server"],
  status: status("trusted"),
  workspace: "polaris",
  canFormat: false,
  canShowLog: false,
  ...patch,
});

describe("the focused file's context", () => {
  test("no focused file adds nothing", () => {
    expect(fileContext(null)).toEqual({});
  });

  test("a trusted TypeScript file", () => {
    const { keys, values } = fileContext(file());

    expect(keys).toEqual([
      "editor.file",
      "trust.known",
      "trust.trusted",
      "language.server",
      "language.typescript",
    ]);
    expect(values).toEqual({
      language: "TypeScript",
      file: "reconnect.ts",
      trustSubject: "polaris",
      typescriptChoice: "project 7.0.2 or bundled",
    });
  });

  test("Format document waits for the Host's capability; the log for a listener", () => {
    expect(fileContext(file()).keys).not.toContain("language.formatter");
    const keys = fileContext(file({ canFormat: true, canShowLog: true })).keys ?? [];

    expect(keys.includes("language.formatter") && keys.includes("language.log")).toBe(true);
    expect(fileContext(file({ canFormat: true, providers: [] })).keys).not.toContain(
      "language.formatter"
    );
  });

  test("a file with only syntax has no server; Trust unknown until discovery says", () => {
    const { keys } = fileContext(file({ language: "toml", providers: [], status: null }));

    expect(keys).toEqual(["editor.file"]);
  });

  test("a Review Checkout's Trust is about this review checkout", () => {
    const { values, keys } = fileContext(file({ status: status("declined", { review: true }) }));

    expect(values?.trustSubject).toBe("this review checkout");
    expect(keys).toContain("trust.declined");
  });
});

describe("Select TypeScript version…", () => {
  test("the project's version needs Trust", () => {
    const chosen: Array<string> = [];
    const asked = typescriptFollowUp(status("declined"), "polaris", (s) => chosen.push(s));

    expect(asked.choices.map((c) => [c.title, c.detail, c.disabled ?? false])).toEqual([
      ["Use the project's TypeScript 7.0.2", "Needs trust in polaris", true],
      ["Use the bundled TypeScript", "In use", false],
    ]);
    asked.choices[1]?.run();
    expect(chosen).toEqual(["use-bundled"]);
  });

  test("trusted: the project's is in use and either can be chosen", () => {
    const chosen: Array<string> = [];
    const asked = typescriptFollowUp(status("trusted"), "polaris", (s) => chosen.push(s));

    expect(asked.choices.map((c) => [c.detail, c.disabled ?? false])).toEqual([
      ["In use", false],
      ["", false],
    ]);
    asked.choices[0]?.run();
    expect(chosen).toEqual(["use-project"]);
  });

  test("a checkout without TypeScript of its own can only use the bundled one", () => {
    const asked = typescriptFollowUp(status("trusted", { version: null }), "polaris", () => {});

    expect(asked.choices[0]).toMatchObject({
      title: "Use the project's TypeScript",
      detail: "No TypeScript in polaris",
      disabled: true,
    });
  });
});

describe("Trust polaris…", () => {
  test("undecided offers Trust and Not now, with what would run", () => {
    const decided: Array<string> = [];
    const asked = trustFollowUp(status("undecided"), "polaris", "this Mac", (a) => decided.push(a));

    expect(asked.title).toBe("Run polaris's own TypeScript?");
    expect(asked.note).toContain("runs it on this Mac as you");
    expect(asked.choices.map((c) => c.title)).toEqual(["Trust polaris", "Not now"]);
    asked.choices[0]?.run();
    expect(decided).toEqual(["trust"]);
  });

  test("after Not now, only Trust is asked", () => {
    const asked = trustFollowUp(status("declined"), "polaris", "this Mac", () => {});

    expect(asked.choices.map((c) => c.id)).toEqual(["trust"]);
  });
});

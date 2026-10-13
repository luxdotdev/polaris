import "../../../test/dom.testing.ts";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { IpcError, LanguageApi } from "../../../../shared/api.ts";
import { changeTrust, decideTrust } from "./decide.ts";
import { providerName, trustCopy, trustFailure, type TrustStatus } from "./model.ts";
import { hostInSentence } from "../../../shell/hostCopy.ts";
import { trustChangedFiles, trustDiscovered, trustStore, useTrustAsk } from "./store.ts";
import { TrustCard } from "./TrustCard.tsx";

const HOST = "mac-studio";

const hostId = P.HostId.make("host-1");

const workspaceId = P.WorkspaceId.make("ws-1");

const workspaceScope = P.LanguageTrustScope.cases.Workspace.make({ hostId, workspaceId });

const reviewScope = P.LanguageTrustScope.cases.ReviewCheckout.make({
  hostId,
  workspaceId,
  reviewCheckoutId: P.ReviewCheckoutId.make("review-1"),
});

const workspaceCheckout = P.LanguageCheckout.cases.Workspace.make({
  workspaceId,
  path: "/code/polaris",
});

const worktreeCheckout = P.LanguageCheckout.cases.Worktree.make({
  workspaceId,
  worktreeId: P.WorktreeId.make("wt-1"),
  path: "/code/polaris-wt",
});

const reviewCheckout = P.LanguageCheckout.cases.ReviewCheckout.make({
  workspaceId,
  reviewCheckoutId: P.ReviewCheckoutId.make("review-1"),
  path: "/code/polaris-review",
});

type Decision = "undecided" | "trusted" | "declined";

const status = (
  options: {
    readonly scope?: typeof P.LanguageTrustScope.Type;
    readonly revision?: number;
    readonly decision?: Decision;
    readonly ask?: boolean;
    readonly plugins?: readonly string[];
    readonly version?: string | null;
  } = {}
): TrustStatus => {
  const decision = options.decision ?? "undecided";

  return P.LanguageTrustStatus.make({
    trust: P.LanguageTrust.make({
      scope: options.scope ?? workspaceScope,
      revision: options.revision ?? 1,
      trusted: decision === "trusted",
      decision,
    }),
    wouldRun: {
      typescriptVersion: options.version === undefined ? "7.0.2" : options.version,
      typescriptPath: "/code/polaris/node_modules/typescript",
      native: true,
      plugins: options.plugins ?? ["ts-plugin-a", "ts-plugin-b"],
    },
    ask: options.ask ?? decision === "undecided",
    provider: decision === "trusted" ? "project" : "bundled",
  });
};

const discovery = (checkout: P.LanguageCheckout, request: TrustStatus) =>
  P.LanguageDiscovery.make({
    checkout,
    projectRoot: checkout.path,
    providers: [],
    effectiveSettings: P.LanguageEffectiveSettings.make({
      revision: 0,
      formatOnSave: false,
      formatter: P.LanguageFormatterSelection.cases.None.make({}),
      providers: [],
      settings: {},
      origins: {},
    }),
    trust: request.trust,
    trustRequest: request,
  });

const discover = (checkout: P.LanguageCheckout, request: TrustStatus, path = "a.ts") => {
  const file = `${HOST}:${checkout.path}/${path}`;
  trustDiscovered(
    { hostKey: HOST, checkout, path: `${checkout.path}/${path}` },
    file,
    discovery(checkout, request)
  );

  return file;
};

type Answer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: IpcError };

interface Call {
  readonly method: string;
  readonly action: string | null;
  readonly expectedRevision: number | null;
  readonly checkout: P.LanguageCheckout | null;
  readonly resolve: (answer: Answer) => void;
}

/** A Language API whose answers the test gives by hand, so each phase can be held. */
const manualApi = () => {
  const calls: Call[] = [];

  const api: LanguageApi = {
    request: (method, input) =>
      new Promise((resolve) => {
        calls.push({
          method,
          action: "action" in input ? input.action : null,
          expectedRevision: "expectedRevision" in input ? input.expectedRevision : null,
          checkout: "checkout" in input ? input.checkout : null,
          // SAFETY: each test answers with the shape the method returns over IPC.
          resolve: (answer) => resolve(answer as never),
        });
      }),
    subscribe: () => () => undefined,
  };

  return { api, calls };
};

const languageError = (
  reason: P.LanguageError["reason"],
  message = "unrelated text"
): IpcError => ({
  code: "language",
  message,
  languageError: Schema.encodeSync(P.LanguageError)(
    new P.LanguageError({ reason, message, retryable: true })
  ),
});

const Harness = ({ file, api }: { readonly file: string; readonly api: LanguageApi }) => {
  const open = useTrustAsk(file);

  return open === null ? null : (
    <TrustCard
      status={open.ask.status}
      phase={open.ask.phase}
      workspace="polaris"
      host="Mac Studio"
      onDecide={(action) => void decideTrust(api, open.key, action)}
    />
  );
};

const card = (container: HTMLElement) => container.querySelector('[data-testid="trust-card"]');

const settle = () => act(async () => await Promise.resolve());

beforeEach(() => trustStore.setState({ asks: {}, files: {}, settled: {}, statuses: {} }));

afterEach(cleanup);

describe("Trust card states", () => {
  test("asking: says what would run, where, and offers Not now then Trust", () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    const dialog = view.getByRole("dialog", { name: "Run polaris's own TypeScript?" });

    expect(dialog.getAttribute("data-phase")).toBe("asking");
    expect(dialog.textContent).toContain(
      "This workspace has TypeScript 7.0.2 and 2 tsconfig plugins. Trusting it runs them on Mac Studio as you, so errors match what tsc reports."
    );
    expect(dialog.textContent).toContain("Change this any time with ⇧⌘P.");
    const buttons = view.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Not now", "Trust polaris"]);
    expect(calls).toHaveLength(0);
  });

  test("submitting: Trust is sent once with the ask's revision while it waits", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status({ revision: 4 }));
    const view = render(<Harness file={file} api={api} />);

    fireEvent.click(view.getByRole("button", { name: "Trust polaris" }));
    await settle();
    fireEvent.click(view.getByRole("button", { name: "Trusting…" }));
    fireEvent.click(view.getByRole("button", { name: "Not now" }));

    expect(card(view.container)?.getAttribute("data-phase")).toBe("submitting");
    expect(card(view.container)?.getAttribute("aria-busy")).toBe("true");
    expect(calls.map((c) => [c.method, c.action, c.expectedRevision])).toEqual([
      ["languages.trust.change", "trust", 4],
    ]);
    expect(calls[0]?.checkout).toEqual(workspaceCheckout);
  });

  test("failed: the typed reason shows on the card, and trying again works", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    fireEvent.click(view.getByRole("button", { name: "Trust polaris" }));
    await act(async () =>
      calls[0]?.resolve({ ok: false, error: languageError("not-connected", "timeout") })
    );

    expect(view.getByRole("alert").textContent).toBe(
      "Can't reach Mac Studio. Try again when it's back."
    );
    expect(card(view.container)?.getAttribute("data-phase")).toBe("failed");

    fireEvent.click(view.getByRole("button", { name: "Trust polaris" }));
    await settle();
    await act(async () =>
      calls[1]?.resolve({ ok: true, value: status({ decision: "trusted", revision: 2 }) })
    );

    expect(card(view.container)).toBeNull();
  });

  test("hidden after a decision, never asked twice for it, and back after ask again", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    fireEvent.click(view.getByRole("button", { name: "Not now" }));
    await act(async () =>
      calls[0]?.resolve({ ok: true, value: status({ decision: "declined", revision: 2 }) })
    );
    expect(calls[0]?.action).toBe("decline");
    expect(card(view.container)).toBeNull();

    act(() => {
      discover(workspaceCheckout, status({ revision: 2, ask: true }));
    });
    expect(card(view.container)).toBeNull();

    const again = changeTrust(
      api,
      { hostKey: HOST, checkout: workspaceCheckout, path: "/code/polaris/a.ts" },
      "ask-again",
      2
    );

    await act(async () => calls[1]?.resolve({ ok: true, value: status({ revision: 3 }) }));
    await again;
    expect(calls[1]?.action).toBe("ask-again");
    expect(card(view.container)?.getAttribute("data-phase")).toBe("asking");
  });

  test("a revision conflict re-reads the scope and hides when another Client decided", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    fireEvent.click(view.getByRole("button", { name: "Not now" }));
    await act(async () => calls[0]?.resolve({ ok: false, error: languageError("conflict") }));
    await waitFor(() => expect(calls[1]?.method).toBe("languages.trust.inspect"));
    await act(async () =>
      calls[1]?.resolve({ ok: true, value: status({ decision: "trusted", revision: 2 }) })
    );

    expect(card(view.container)).toBeNull();
  });
});

describe("Trust card keyboard", () => {
  test("focus goes Not now then Trust, and Esc is Not now", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    const focusable = [...(card(view.container)?.querySelectorAll("button") ?? [])];
    expect(focusable.map((b) => b.textContent)).toEqual(["Not now", "Trust polaris"]);
    expect(focusable.every((b) => b.tabIndex === 0 && !b.disabled)).toBe(true);

    const trust = view.getByRole("button", { name: "Trust polaris" });
    trust.focus();
    fireEvent.keyDown(trust, { key: "Escape" });
    await settle();

    expect(calls.map((c) => c.action)).toEqual(["decline"]);
    expect(document.activeElement).toBe(trust);
  });

  test("Esc while submitting sends nothing more", async () => {
    const { api, calls } = manualApi();
    const file = discover(workspaceCheckout, status());
    const view = render(<Harness file={file} api={api} />);

    fireEvent.click(view.getByRole("button", { name: "Trust polaris" }));
    await settle();
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });

    expect(calls).toHaveLength(1);
  });
});

describe("Trust scopes", () => {
  test("a Worktree follows its Workspace; a Review Checkout keeps its own ask", async () => {
    const { api, calls } = manualApi();
    const main = discover(workspaceCheckout, status());
    const worktree = discover(worktreeCheckout, status({ ask: false }));
    const review = discover(reviewCheckout, status({ scope: reviewScope }));

    const view = render(
      <>
        <Harness file={worktree} api={api} />
        <Harness file={review} api={api} />
        <Harness file={main} api={api} />
      </>
    );

    expect(view.getAllByRole("dialog")).toHaveLength(3);
    expect(view.getByRole("button", { name: "Trust review checkout" })).toBeDefined();

    fireEvent.click(view.getAllByRole("button", { name: "Trust polaris" })[0]!);
    await act(async () =>
      calls[0]?.resolve({ ok: true, value: status({ decision: "trusted", revision: 2 }) })
    );

    expect(view.getAllByRole("dialog")).toHaveLength(1);
    expect(view.getByRole("dialog").textContent).toContain("This review checkout has");
  });
});

describe("Trust copy", () => {
  test("names only what would run", () => {
    expect(trustCopy(status({ plugins: [] }), "polaris", "Mac Studio").body).toBe(
      "This workspace has TypeScript 7.0.2. Trusting it runs it on Mac Studio as you, so errors match what tsc reports."
    );
    expect(trustCopy(status({ version: null, plugins: ["one"] }), "polaris", "Pi").body).toBe(
      "This workspace has 1 tsconfig plugin. Trusting it runs them on Pi as you, so errors match what tsc reports."
    );
  });

  test("failure copy follows the reason, not the message", () => {
    const error = new P.LanguageError({ reason: "timeout", message: "conflict", retryable: true });

    expect(trustFailure(error, "this Mac")).toBe("No answer from this Mac in time. Try again.");
  });
});

describe("What runs, in words", () => {
  test("the TypeScript provider names the Daemon's selection, as the language status does", () => {
    expect(providerName("typescript-language-server", null)).toBe("typescript-language-server");
    expect(providerName("typescript-language-server", status())).toBe("TypeScript · bundled");
    expect(
      providerName("typescript-language-server", status({ decision: "trusted", revision: 2 }))
    ).toBe("TypeScript 7.0.2");
    expect(providerName("pyright", status({ decision: "trusted" }))).toBe("pyright");
  });

  test("the local host reads this Mac mid-sentence; a named host keeps its name", () => {
    const host = (label: string, alias: string | null) => ({
      key: label,
      label,
      colour: null,
      alias,
      proofHarness: false,
      // SAFETY: hostInSentence reads only the label and alias.
      status: { state: "connected" as const, latencyMs: null } as never,
    });

    expect(hostInSentence(host("This Mac", null))).toBe("this Mac");
    expect(hostInSentence(host("Mac Studio", null))).toBe("Mac Studio");
    expect(hostInSentence(host("This Mac", "this-mac"))).toBe("This Mac");
    expect(hostInSentence(undefined)).toBe("this host");
  });
});

test("Svelte and Prisma share the existing Workspace Trust ask", () => {
  const first = status({ version: null, plugins: [] });

  const prisma = P.LanguageTrustStatus.make({
    ...first,
    wouldRun: { ...first.wouldRun, workspaceTools: ["Prisma config"] },
  });

  discover(workspaceCheckout, prisma, "schema.prisma");

  const svelte = P.LanguageTrustStatus.make({
    ...first,
    ask: false,
    wouldRun: { ...first.wouldRun, workspaceTools: ["Svelte config and preprocessors"] },
  });

  discover(workspaceCheckout, svelte, "Component.svelte");
  expect(Object.values(trustStore.getState().asks)).toHaveLength(1);
  expect(Object.values(trustStore.getState().asks)[0]?.status).toEqual(svelte);
  expect(trustCopy(svelte, "web", "this Mac").body).toContain("Svelte config and preprocessors");
});

test("a Trust change names the open files of its scope, so a Trust-blocked server is looked for again", () => {
  const before = {
    asks: {},
    settled: {},
    targets: {},
    files: { "go/main.go": "scope", "other/a.ts": "other" },
    statuses: { scope: status({ revision: 1 }), other: status({ revision: 4 }) },
  };

  const after = {
    ...before,
    statuses: { ...before.statuses, scope: status({ revision: 2, decision: "trusted" }) },
  };

  expect([...trustChangedFiles(after, before)]).toEqual(["go/main.go"]);
  expect(trustChangedFiles(before, before).size).toBe(0);
});

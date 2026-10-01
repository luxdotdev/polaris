/**
 * What the Review Checkout chip and its menu show (Paper R4 804-0, R5 8B5-0), derived from
 * the checkout the Host folded, its Host's Connection State and what this window removed.
 * Pure: the UI renders a `ChipView` and runs its `CheckoutFix`.
 */
import type { ReviewCheckout, ReviewCheckoutBlock, SessionId } from "@polaris/protocol";
import { Match } from "effect";

/** Commits are shown by their first seven characters. */
export const shortSha = (sha: string | null) => (sha === null ? "" : sha.slice(0, 7));

/** What one click in a blocked chip does: each blocker has exactly one. */
export type CheckoutFix =
  | { readonly kind: "retry"; readonly label: "Retry" }
  | { readonly kind: "fetch-full"; readonly label: "Fetch full history" }
  | { readonly kind: "discard-update"; readonly label: "Discard edits and update" }
  | { readonly kind: "discard-remove"; readonly label: "Discard edits and remove" }
  | { readonly kind: "open-terminal"; readonly label: "Open a terminal" }
  | { readonly kind: "show-terminal"; readonly label: "Show terminal" }
  | {
      readonly kind: "show-session";
      readonly label: "Show session";
      readonly sessionId: SessionId;
    };

export interface BlockView {
  /** The chip's words: "Couldn’t check out on Linux VM". */
  readonly title: string;
  /** One line of fact for the menu: what happened, and what the fix does. */
  readonly fact: string;
  /** The evidence in mono: the git error, or the changed paths. */
  readonly evidence: ReadonlyArray<string>;
  readonly fix: CheckoutFix;
  /** The fix throws work away, so it asks once more before it runs. */
  readonly confirm: string | null;
}

/** Paths listed before "and N more". */
const PATHS_SHOWN = 4;

const pathsOf = (paths: ReadonlyArray<string>) =>
  paths.length <= PATHS_SHOWN
    ? paths
    : [...paths.slice(0, PATHS_SHOWN), `and ${paths.length - PATHS_SHOWN} more`];

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The Daemon names a missing ssh agent this way (`git/review/fetch.ts`). */
const NO_AGENT = /SSH_AUTH_SOCK|no SSH agent/i;

/** Why the checkout is blocked, in the chip's words, with its one fix. */
export const blockView = (block: ReviewCheckoutBlock, host: string): BlockView =>
  Match.value(block.blocker).pipe(
    Match.tagsExhaustive({
      Dirty: ({ paths }): BlockView => {
        const removing = block.during === "remove";

        return {
          title: `Edits in the checkout on ${host}`,
          fact: removing
            ? `${count(paths.length, "file")} changed in the checkout, so it was kept.`
            : `${count(paths.length, "file")} changed in the checkout, so it stayed at the old commit.`,
          evidence: pathsOf(paths),
          fix: removing
            ? { kind: "discard-remove", label: "Discard edits and remove" }
            : { kind: "discard-update", label: "Discard edits and update" },
          confirm: `Discard ${count(paths.length, "changed file")}?`,
        };
      },
      LocalCommits: ({ count: commits }): BlockView => ({
        title: `${count(commits, "local commit")} in the checkout`,
        fact: "Commits made in the checkout would be lost. Push or move them in a terminal first.",
        evidence: [],
        fix: { kind: "open-terminal", label: "Open a terminal" },
        confirm: null,
      }),
      InUse: ({ sessionIds, terminals }): BlockView => {
        const [sessionId] = sessionIds;

        return sessionId === undefined
          ? {
              title: `A terminal is open in the checkout`,
              fact: `${count(terminals, "terminal")} on ${host} still run in it. Close them, then try again.`,
              evidence: [],
              fix: { kind: "show-terminal", label: "Show terminal" },
              confirm: null,
            }
          : {
              title: `A session is working in the checkout`,
              fact: `It waits until the agent session there stops working.`,
              evidence: [],
              fix: { kind: "show-session", label: "Show session", sessionId },
              confirm: null,
            };
      },
      ShallowClone: (): BlockView => ({
        title: "This workspace is a shallow clone",
        fact: `The pull request’s base isn’t in ${host}’s history. Fetching full history can take a while.`,
        evidence: [],
        fix: { kind: "fetch-full", label: "Fetch full history" },
        confirm: null,
      }),
      FetchFailed: ({ message }): BlockView => ({
        title: NO_AGENT.test(message) ? `No ssh agent on ${host}` : `Couldn’t check out on ${host}`,
        fact: NO_AGENT.test(message)
          ? `The daemon on ${host} can’t reach an ssh agent. Start one for it, or use an https remote.`
          : "Fetches use the host’s own git credentials, not your GitHub sign-in in Polaris.",
        evidence: [message],
        fix: { kind: "retry", label: "Retry" },
        confirm: null,
      }),
    })
  );

/** The Host a checkout lives on, as the chip needs it. */
export interface HostFacts {
  readonly label: string;
  readonly state: "connected" | "reconnecting" | "needs-attention" | "offline";
  /** When the current Connection State began (ms since the epoch). */
  readonly since: number;
}

export interface RemovedFacts {
  readonly host: string;
  readonly reason: "merged" | "closed" | "user";
}

export type ChipView =
  | { readonly kind: "checking-out"; readonly host: string }
  | { readonly kind: "updating"; readonly host: string; readonly to: string }
  | { readonly kind: "ready"; readonly host: string; readonly at: string }
  | {
      readonly kind: "new-commits";
      readonly host: string;
      readonly at: string;
      readonly latest: string;
    }
  | { readonly kind: "blocked"; readonly host: string; readonly block: BlockView }
  | { readonly kind: "removing"; readonly host: string }
  | {
      readonly kind: "reconnecting";
      readonly host: string;
      readonly at: string;
      readonly seconds: number;
    }
  | { readonly kind: "offline"; readonly host: string; readonly next: string | null }
  | { readonly kind: "waiting"; readonly host: string }
  | { readonly kind: "none" }
  | { readonly kind: "removed"; readonly host: string; readonly reason: RemovedFacts["reason"] };

export interface ChipInput {
  /** The checkout the chip speaks for (the chosen Host's), with its Host. */
  readonly checkout: ReviewCheckout | null;
  readonly host: HostFacts | null;
  /** How many Workspaces hold the repository. */
  readonly places: number;
  /** The first connected Host holding it, other than the checkout's (null: none is). */
  readonly firstConnected: string | null;
  /** The first Host with the repository, connected or not. */
  readonly firstPlace: string | null;
  /** What this window last removed for the pull request, while none is checked out. */
  readonly removed: RemovedFacts | null;
  readonly now: number;
}

const fromCheckout = (checkout: ReviewCheckout, host: string): ChipView =>
  Match.value(checkout.state).pipe(
    Match.withReturnType<ChipView>(),
    Match.when("fetching", () =>
      checkout.head === null
        ? { kind: "checking-out", host }
        : { kind: "updating", host, to: shortSha(checkout.latestHead) }
    ),
    Match.when("ready", () => ({ kind: "ready", host, at: shortSha(checkout.head) })),
    Match.when("stale", () => ({
      kind: "new-commits",
      host,
      at: shortSha(checkout.head),
      latest: shortSha(checkout.latestHead),
    })),
    Match.when("blocked", () =>
      checkout.blocked === null
        ? { kind: "ready", host, at: shortSha(checkout.head) }
        : { kind: "blocked", host, block: blockView(checkout.blocked, host) }
    ),
    Match.when("removing", () => ({ kind: "removing", host })),
    Match.exhaustive
  );

/** The chip's state: the checkout's own, unless its Host is away. */
export const chipView = (input: ChipInput): ChipView => {
  const { checkout, host } = input;

  if (checkout === null || host === null) {
    if (input.removed !== null) return { kind: "removed", ...input.removed };

    if (input.places === 0) return { kind: "none" };

    return { kind: "waiting", host: input.firstConnected ?? input.firstPlace ?? "" };
  }

  if (host.state === "reconnecting") {
    return {
      kind: "reconnecting",
      host: host.label,
      at: shortSha(checkout.head),
      seconds: Math.max(0, Math.round((input.now - host.since) / 1000)),
    };
  }

  if (host.state !== "connected") {
    return { kind: "offline", host: host.label, next: input.firstConnected };
  }

  return fromCheckout(checkout, host.label);
};

/** The chip's trailing action, after its divider; null when it has none. */
export type ChipAction =
  | { readonly kind: "update"; readonly label: "Update" }
  | { readonly kind: "fix"; readonly label: string }
  | { readonly kind: "move"; readonly label: string };

export const chipAction = (view: ChipView): ChipAction | null =>
  Match.value(view).pipe(
    Match.withReturnType<ChipAction | null>(),
    Match.discriminator("kind")("new-commits", () => ({ kind: "update", label: "Update" })),
    Match.discriminator("kind")("blocked", ({ block }) => ({
      kind: "fix",
      label: block.fix.label,
    })),
    Match.discriminator("kind")("offline", ({ next }) =>
      next === null ? null : { kind: "move", label: `Check out on ${next}` }
    ),
    Match.orElse(() => null)
  );

/** "Merged · checkout removed from Linux VM". */
export const removedText = (reason: RemovedFacts["reason"], host: string) =>
  Match.value(reason).pipe(
    Match.when("merged", () => `Merged · checkout removed from ${host}`),
    Match.when("closed", () => `Closed · checkout removed from ${host}`),
    Match.when("user", () => `Checkout removed from ${host}`),
    Match.exhaustive
  );

/** "40s", "3m", "2h": how long a Host has been reconnecting. */
export const elapsed = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;

  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;

  return `${Math.floor(seconds / 3600)}h`;
};

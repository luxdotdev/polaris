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
  | {
      readonly kind: "checking-out";
      readonly host: string;
      /** The pull request's commits being fetched, once GitHub has counted them. */
      readonly commits: number | null;
    }
  | { readonly kind: "updating"; readonly host: string; readonly to: string }
  | {
      readonly kind: "ready";
      readonly host: string;
      readonly at: string;
      /** What Run starts; null when the checkout has nothing to run. */
      readonly command: string | null;
    }
  | {
      readonly kind: "running";
      readonly host: string;
      readonly command: string;
      readonly seconds: number;
    }
  | {
      readonly kind: "new-commits";
      readonly host: string;
      readonly at: string;
      readonly latest: string;
      /** Null until GitHub has compared the two commits. */
      readonly count: number | null;
      /** The branch was rewritten (a force-push): the checkout's commit isn't in it any more. */
      readonly rewritten: boolean;
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
  | { readonly kind: "cloning"; readonly host: string }
  | { readonly kind: "clone-failed"; readonly host: string; readonly message: string }
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
  /** What Run would start in the checkout (null: nothing to run). */
  readonly command: string | null;
  /** The run going in the checkout, with when it started (ms). */
  readonly run: { readonly command: string; readonly startedAt: number } | null;
  /** GitHub's comparison of the checkout's commit with the pull request's head. */
  readonly newCommits: { readonly total: number; readonly rewritten: boolean } | null;
  /** On a first checkout: how many commits the pull request has over its base. */
  readonly fetchingCommits: number | null;
  /** A clone this window started because no Workspace had the repository. */
  readonly clone: {
    readonly host: string;
    readonly status: "cloning" | "failed" | "added";
    readonly message: string | null;
  } | null;
}

const seconds = (now: number, since: number) => Math.max(0, Math.round((now - since) / 1000));

const fromCheckout = (checkout: ReviewCheckout, host: string, input: ChipInput): ChipView =>
  Match.value(checkout.state).pipe(
    Match.withReturnType<ChipView>(),
    Match.when("fetching", () =>
      checkout.head === null
        ? { kind: "checking-out", host, commits: input.fetchingCommits }
        : { kind: "updating", host, to: shortSha(checkout.latestHead) }
    ),
    Match.when("ready", () =>
      input.run === null
        ? { kind: "ready", host, at: shortSha(checkout.head), command: input.command }
        : {
            kind: "running",
            host,
            command: input.run.command,
            seconds: seconds(input.now, input.run.startedAt),
          }
    ),
    Match.when("stale", () => ({
      kind: "new-commits",
      host,
      at: shortSha(checkout.head),
      latest: shortSha(checkout.latestHead),
      count: input.newCommits?.total ?? null,
      rewritten: input.newCommits?.rewritten ?? false,
    })),
    Match.when("blocked", () =>
      checkout.blocked === null
        ? { kind: "ready", host, at: shortSha(checkout.head), command: input.command }
        : { kind: "blocked", host, block: blockView(checkout.blocked, host) }
    ),
    Match.when("removing", () => ({ kind: "removing", host })),
    Match.exhaustive
  );

/** No checkout: what this window removed, a clone under way, or why it waits. */
const withoutCheckout = (input: ChipInput): ChipView => {
  if (input.removed !== null) return { kind: "removed", ...input.removed };

  const { clone } = input;

  if (clone?.status === "failed") {
    return { kind: "clone-failed", host: clone.host, message: clone.message ?? "" };
  }

  // A clone that finished is a Workspace once the PR list matches it.
  if (clone !== null && input.places === 0) return { kind: "cloning", host: clone.host };

  if (input.places === 0) return { kind: "none" };

  return { kind: "waiting", host: input.firstConnected ?? input.firstPlace ?? "" };
};

/** The chip's state: the checkout's own, unless its Host is away. */
export const chipView = (input: ChipInput): ChipView => {
  const { checkout, host } = input;

  if (checkout === null || host === null) return withoutCheckout(input);

  if (host.state === "reconnecting") {
    return {
      kind: "reconnecting",
      host: host.label,
      at: shortSha(checkout.head),
      seconds: seconds(input.now, host.since),
    };
  }

  if (host.state !== "connected") {
    return { kind: "offline", host: host.label, next: input.firstConnected };
  }

  return fromCheckout(checkout, host.label, input);
};

/** The chip's trailing action, after its divider; null when it has none. */
export type ChipAction =
  | { readonly kind: "update"; readonly label: "Update" }
  | { readonly kind: "fix"; readonly label: string }
  | { readonly kind: "move"; readonly label: string }
  | { readonly kind: "run"; readonly label: "Run" }
  | { readonly kind: "stop"; readonly label: "Stop" }
  | { readonly kind: "clone"; readonly label: "Clone on…" }
  | { readonly kind: "retry-clone"; readonly label: "Retry" };

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
    Match.discriminator("kind")("ready", ({ command }) =>
      command === null ? null : { kind: "run", label: "Run" }
    ),
    Match.discriminator("kind")("running", () => ({ kind: "stop", label: "Stop" })),
    Match.discriminator("kind")("none", () => ({ kind: "clone", label: "Clone on…" })),
    Match.discriminator("kind")("clone-failed", () => ({ kind: "retry-clone", label: "Retry" })),
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

/** "2 new commits", "1 new commit", "force-pushed"; "new commits" until GitHub has counted. */
export const newCommitsText = (count: number | null, rewritten: boolean) => {
  if (rewritten) return "force-pushed";

  if (count === null) return "new commits";

  return count === 1 ? "1 new commit" : `${count} new commits`;
};

/** "fetching", then "fetching 3 commits" once GitHub has counted them. */
export const fetchingText = (commits: number | null) => {
  if (commits === null) return "fetching";

  return commits === 1 ? "fetching 1 commit" : `fetching ${commits} commits`;
};

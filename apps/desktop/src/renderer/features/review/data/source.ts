/**
 * Where a Review's diff comes from. A pull request diffs its Review Checkout (`mergeBase` to
 * `head`, on the Host that holds it); an Agent Session diffs each picked Turn on its own, so
 * the view can group files by Turn. Pure, so it is tested; `useReviewDiff` fetches it.
 */
import type { GitDiffSpec, ReviewCheckout, SessionId, TurnId } from "@polaris/protocol";
import { Data, Predicate } from "effect";
import type { OpenPull } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import type { SectionDivider } from "../model/layout.ts";

export interface SourceSection {
  readonly id: string;
  readonly divider: SectionDivider | null;
  readonly spec: GitDiffSpec;
  /** Revisions for context expansion (`git.show`); null `next` reads the working tree. */
  readonly base: string | null;
  readonly next: string | null;
}

export interface DiffSource {
  readonly hostKey: string;
  readonly cwd: string;
  readonly sections: ReadonlyArray<SourceSection>;
  /** Changes when what the diff shows may have changed. */
  readonly key: string;
}

/** A pull request whose diff can't be read yet: why, and what the view may offer. */
export type CheckoutWait =
  /** No Review Checkout on any Host: `hosts` hold a Workspace with its repository. */
  | { readonly kind: "none"; readonly hosts: ReadonlyArray<CheckoutPlace> }
  | { readonly kind: "fetching"; readonly hostKey: string; readonly checkout: ReviewCheckout }
  | { readonly kind: "failed"; readonly hostKey: string; readonly checkout: ReviewCheckout };

export interface CheckoutPlace {
  readonly hostKey: string;
  readonly workspaceId: string;
}

export type PullSourceState =
  | { readonly kind: "ready"; readonly source: DiffSource; readonly checkout: ReviewCheckout }
  | { readonly kind: "waiting"; readonly wait: CheckoutWait };

const Specs = Data.taggedEnum<GitDiffSpec>();

const isPull = ({ subject }: ReviewCheckout, pull: OpenPull) =>
  Predicate.isTagged(subject, "PullRequest") &&
  subject.pullRequest.number === pull.number &&
  subject.pullRequest.repo.owner.toLowerCase() === pull.repo.owner.toLowerCase() &&
  subject.pullRequest.repo.name.toLowerCase() === pull.repo.name.toLowerCase();

/** Every Review Checkout of this pull request, with its Host; the newest first. */
export const checkoutsOf = (
  pull: OpenPull,
  models: Readonly<Record<string, HostModel>>
): ReadonlyArray<{ readonly hostKey: string; readonly checkout: ReviewCheckout }> =>
  Object.entries(models)
    .flatMap(([hostKey, model]) =>
      [...model.reviewCheckouts.values()].flatMap((checkout) =>
        isPull(checkout, pull) ? [{ hostKey, checkout }] : []
      )
    )
    .sort((a, b) => b.checkout.updatedAt.localeCompare(a.checkout.updatedAt));

export const pullSource = (
  pull: OpenPull,
  models: Readonly<Record<string, HostModel>>,
  places: ReadonlyArray<CheckoutPlace>,
  /** The Host the user chose (the repository's last used): its checkout wins. */
  preferHost: string | null = null
): PullSourceState => {
  const all = checkoutsOf(pull, models);

  const found = [
    ...all.filter((f) => f.hostKey === preferHost),
    ...all.filter((f) => f.hostKey !== preferHost),
  ];

  // A checkout that has fetched once keeps its diff while it updates or is blocked.
  const [usable] = found.flatMap(({ hostKey, checkout }) =>
    checkout.head === null || checkout.mergeBase === null
      ? []
      : [{ hostKey, checkout, head: checkout.head, base: checkout.mergeBase }]
  );

  if (usable !== undefined) {
    const { hostKey, checkout, head, base } = usable;

    return {
      kind: "ready",
      checkout,
      source: {
        hostKey,
        cwd: checkout.path,
        sections: [
          { id: "pull", divider: null, spec: Specs.Range({ base, head }), base, next: head },
        ],
        key: `${hostKey}:${checkout.id}:${base}:${head}`,
      },
    };
  }

  const [first] = found;

  if (first === undefined) return { kind: "waiting", wait: { kind: "none", hosts: places } };

  return {
    kind: "waiting",
    wait: { kind: first.checkout.state === "blocked" ? "failed" : "fetching", ...first },
  };
};

/** A Turn as the source needs it (`Turn` from the protocol). */
export interface TurnInfo {
  readonly id: TurnId;
  readonly index: number;
  readonly prompt: string;
  readonly checkpointBefore: string | null;
  readonly checkpointAfter: string | null;
  readonly status: string;
}

/** Which Turns to show: one, or every Turn since the last accept. */
export type TurnPick =
  | { readonly kind: "all" }
  | { readonly kind: "turn"; readonly turnId: TurnId };

/** Turns since the last accept; every Turn when all were accepted. */
export const pendingTurns = (
  turns: ReadonlyArray<TurnInfo>,
  acceptedThroughIndex: number | null
): ReadonlyArray<TurnInfo> => {
  const pending = turns.filter((t) => t.index > (acceptedThroughIndex ?? -1));

  return pending.length > 0 ? pending : turns;
};

const quoteOf = (prompt: string) => {
  const line = prompt.trim().split("\n")[0] ?? "";

  return line === "" ? null : line.length > 90 ? `${line.slice(0, 89)}…` : line;
};

export const sessionSource = (
  hostKey: string,
  session: {
    readonly id: SessionId;
    readonly cwd: string;
    readonly harness: string;
    readonly acceptedThroughIndex?: number | null;
  },
  turns: ReadonlyArray<TurnInfo>,
  pick: TurnPick
): DiffSource => {
  const shown =
    pick.kind === "turn"
      ? turns.filter((t) => t.id === pick.turnId)
      : pendingTurns(turns, session.acceptedThroughIndex ?? null);

  // Newest first (Paper R2); the layout folds the older ones.
  const sections = shown.toReversed().map((turn): SourceSection => ({
    id: turn.id,
    divider: { turn: turn.index + 1, harness: session.harness, quote: quoteOf(turn.prompt) },
    spec: Specs.Turn({ sessionId: session.id, turnId: turn.id }),
    base: turn.checkpointBefore,
    next: turn.checkpointAfter,
  }));

  return {
    hostKey,
    cwd: session.cwd,
    sections,
    key: [
      hostKey,
      session.id,
      ...shown.map((t) => `${t.id}:${t.status}:${t.checkpointAfter ?? ""}`),
    ].join("\u0000"),
  };
};

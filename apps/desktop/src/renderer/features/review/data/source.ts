/**
 * Where a Review's diff comes from. A pull request diffs its Review Checkout (`mergeBase` to
 * `head`, on the Host that holds it); an Agent Session diffs each picked Turn on its own, so
 * the view can group files by Turn. Pure, so it is tested; `useReviewDiff` fetches it.
 */
import type { GitDiffSpec, ReviewCheckout, SessionId, TurnId } from "@polaris/protocol";
import { Data, Predicate } from "effect";
import type { OpenPull } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import type { TurnView } from "../../../store/sessionModel.ts";
import { groupTurns, harnessStarted, openingView } from "../../session/model/turnGroups.ts";
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

/** A Turn as the UI numbers it (`turnGroups.ts`): the user's Turn and those the Harness started. */
export interface ReviewTurn {
  /** Its opening Turn's id. */
  readonly id: TurnId;
  readonly number: number;
  /** The user's prompt; null when the Harness opened it. */
  readonly prompt: string | null;
  /** Its Turns in order, never empty; since the last accept, only those after it. */
  readonly turns: ReadonlyArray<TurnInfo>;
}

/** The session's Turns as Review shows them, one per user message. */
export const reviewTurns = (views: ReadonlyArray<TurnView>): ReadonlyArray<ReviewTurn> =>
  groupTurns(views).map((group) => {
    const opening = openingView(group).turn;

    return {
      id: group.id,
      number: group.number,
      prompt: harnessStarted(opening) ? null : opening.prompt,
      turns: group.views.map((v) => v.turn),
    };
  });

/** Which Turns to show: one, or every Turn since the last accept. */
export type TurnPick =
  | { readonly kind: "all" }
  | { readonly kind: "turn"; readonly turnId: TurnId };

/** Turns with work after the last accept, each cut to its Turns after it. */
export const unacceptedTurns = (
  turns: ReadonlyArray<ReviewTurn>,
  acceptedThroughIndex: number | null
): ReadonlyArray<ReviewTurn> =>
  turns.flatMap((turn) => {
    const after = turn.turns.filter((t) => t.index > (acceptedThroughIndex ?? -1));

    return after.length === 0 ? [] : [{ ...turn, turns: after }];
  });

/** Turns since the last accept; every Turn when all were accepted. */
export const pendingTurns = (
  turns: ReadonlyArray<ReviewTurn>,
  acceptedThroughIndex: number | null
): ReadonlyArray<ReviewTurn> => {
  const pending = unacceptedTurns(turns, acceptedThroughIndex);

  return pending.length > 0 ? pending : turns;
};

/** "turn 24", "turns 22–24", by the numbers the UI shows. */
export const turnRange = (turns: ReadonlyArray<{ readonly number: number }>): string => {
  const first = turns[0];
  const last = turns.at(-1);

  if (first === undefined || last === undefined) return "turns";

  return first.number === last.number
    ? `turn ${first.number}`
    : `turns ${first.number}–${last.number}`;
};

/** The header's Turn picker shows at most this many single Turns before "All". */
const PICKER_TURNS = 4;

/** The Turn picker's options: the latest pending Turns by number, then all of them. */
export const pickerOptions = (
  pending: ReadonlyArray<ReviewTurn>
): ReadonlyArray<{ readonly value: string; readonly label: string }> => [
  ...pending.slice(-PICKER_TURNS).map((t) => ({ value: t.id, label: `${t.number}` })),
  { value: "all", label: `All ${pending.length} turns` },
];

const quoteOf = (prompt: string | null) => {
  const line = prompt?.trim().split("\n")[0] ?? "";

  return line === "" ? null : line.length > 90 ? `${line.slice(0, 89)}…` : line;
};

interface SourceSession {
  readonly id: SessionId;
  readonly cwd: string;
  readonly harness: string;
  readonly acceptedThroughIndex?: number | null;
}

/** A run of a Turn's Turns as one section: the first one's checkpoint to the last one's. */
const runSection = (
  session: SourceSession,
  turn: ReviewTurn,
  run: ReadonlyArray<TurnInfo>
): SourceSection => {
  // SAFETY: a ReviewTurn, and every run cut from it, has at least one Turn.
  const first = run[0] as TurnInfo;
  // SAFETY: as above.
  const last = run.at(-1) as TurnInfo;

  return {
    id: first.id,
    divider: { turn: turn.number, harness: session.harness, quote: quoteOf(turn.prompt) },
    spec:
      first === last
        ? Specs.Turn({ sessionId: session.id, turnId: first.id })
        : Specs.Turns({ sessionId: session.id, firstTurnId: first.id, lastTurnId: last.id }),
    base: first.checkpointBefore,
    next: last.checkpointAfter,
  };
};

/**
 * One section per Turn, newest first (Paper R2); the layout folds the older ones. Without
 * `git.diff-turns` (`spans` false), a Turn the Harness continued is a section per Turn it ran.
 */
export const sessionSource = (
  hostKey: string,
  session: SourceSession,
  turns: ReadonlyArray<ReviewTurn>,
  pick: TurnPick,
  spans = true
): DiffSource => {
  const shown =
    pick.kind === "turn"
      ? turns.filter((t) => t.id === pick.turnId)
      : pendingTurns(turns, session.acceptedThroughIndex ?? null);

  const sections = shown
    .toReversed()
    .flatMap((turn) =>
      spans
        ? [runSection(session, turn, turn.turns)]
        : turn.turns.toReversed().map((t) => runSection(session, turn, [t]))
    );

  return {
    hostKey,
    cwd: session.cwd,
    sections,
    key: [
      hostKey,
      session.id,
      ...shown.flatMap((s) => s.turns).map((t) => `${t.id}:${t.status}:${t.checkpointAfter ?? ""}`),
    ].join("\u0000"),
  };
};

/** A pull request's diff narrowed to one commit: its parent to it, on the same checkout. */
export const scopeSource = (
  source: DiffSource,
  commit: { readonly oid: string; readonly parent: string }
): DiffSource => ({
  ...source,
  sections: [
    {
      id: `commit:${commit.oid}`,
      divider: null,
      spec: Specs.Range({ base: commit.parent, head: commit.oid }),
      base: commit.parent,
      next: commit.oid,
    },
  ],
  key: `${source.key}@${commit.oid}`,
});

/**
 * Which Turn-ended notifications to show (Settings → Sessions, off by default): one when the
 * user's Turn completes, that is when its session goes Idle with no background tasks left,
 * never for the session the focused window shows. Turns the Harness starts when background
 * tasks report continue the user's Turn, so they never notify again. With a minimum duration
 * set, only Turns longer than it notify, timed from the user's prompt to completion on the
 * Host's clock. A Lead Turn Polaris started for a digest shows nothing. Pure, so unit-tested.
 */
import type { NeedsYouSummary, NeedsYouTurn } from "../../shared/needsYou.ts";
import { notificationKey } from "./plan.ts";

/** Working, Idle with background tasks still live, or Idle with none: completed. */
export type TurnPhase = "working" | "waiting" | "settled";

/** One session's user Turn as the planner follows it. */
export interface TurnTrack {
  readonly phase: TurnPhase;
  /** The user Turn's id; null when the session was first seen from a snapshot. */
  readonly userTurnId: string | null;
  /** When the user Turn started, or when it was first seen under way if unknown (Host clock). */
  readonly startedAt: string | null;
  /** Its completion was decided (shown or held back): a continuation never notifies again. */
  readonly done: boolean;
}

/** Session key → its user Turn at the last summary. */
export type TurnState = ReadonlyMap<string, TurnTrack>;

export const emptyTurnState: TurnState = new Map();

export interface TurnNotification {
  readonly key: string;
  readonly turn: NeedsYouTurn;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
}

export interface TurnPlan {
  readonly show: ReadonlyArray<TurnNotification>;
  readonly close: ReadonlyArray<string>;
  readonly state: TurnState;
}

export interface TurnPlanInput {
  readonly state: TurnState;
  readonly summary: NeedsYouSummary;
  readonly windowFocused: boolean;
  /** Only Turns longer than this notify; null or absent for every Turn. */
  readonly minDurationMs?: number | null;
}

/** Its own key space, so a Needs You banner for the same session never replaces it. */
export const turnKey = (hostKey: string, sessionId: string) =>
  `turn\u0000${notificationKey(hostKey, sessionId)}`;

const contentOf = (key: string, turn: NeedsYouTurn): TurnNotification => ({
  key,
  turn,
  title: `${turn.harness} finished a turn`,
  subtitle: `${turn.title} · ${turn.hostLabel}`,
  body: turn.prompt ?? "Ready for the next turn",
});

const phaseOf = (turn: NeedsYouTurn): TurnPhase => {
  if (turn.state === "working") return "working";

  return turn.backgroundTasks > 0 ? "waiting" : "settled";
};

/** The session's track after this summary: the same user Turn moves on, a new one starts over. */
const advance = (turn: NeedsYouTurn, was: TurnTrack | undefined): TurnTrack => {
  const phase = phaseOf(turn);
  const id = turn.userTurn?.id ?? null;
  const underWay = phase === "settled" ? null : turn.updatedAt;

  if (was !== undefined && was.userTurnId === id)
    return { ...was, phase, startedAt: was.startedAt ?? underWay };

  // A snapshot forgets the user Turn: an unknown one under way keeps the start already seen.
  const carried = id === null && phase !== "settled" ? was?.startedAt : undefined;

  return {
    phase,
    userTurnId: id,
    startedAt: turn.userTurn?.startedAt ?? carried ?? underWay,
    done: false,
  };
};

const longEnough = (turn: NeedsYouTurn, track: TurnTrack, minDurationMs: number | null) => {
  if (minDurationMs === null) return true;

  if (track.startedAt === null) return false;

  return Date.parse(turn.updatedAt) - Date.parse(track.startedAt) > minDurationMs;
};

interface Completion {
  readonly turn: NeedsYouTurn;
  readonly track: TurnTrack;
  readonly summary: NeedsYouSummary;
  readonly windowFocused: boolean;
  readonly minDurationMs: number | null;
}

const notifies = ({ turn, track, summary, windowFocused, minDurationMs }: Completion) => {
  const focused =
    windowFocused &&
    summary.focused?.hostKey === turn.hostKey &&
    summary.focused.sessionId === turn.sessionId;

  return !focused && turn.digestStarted !== true && longEnough(turn, track, minDurationMs);
};

export const planTurnNotifications = ({
  state,
  summary,
  windowFocused,
  minDurationMs = null,
}: TurnPlanInput): TurnPlan => {
  const next = new Map<string, TurnTrack>();
  const show: Array<TurnNotification> = [];
  const close: Array<string> = [];

  for (const turn of summary.turns ?? []) {
    const key = turnKey(turn.hostKey, turn.sessionId);
    const was = state.get(key);
    const track = advance(turn, was);
    const sameTurn = was !== undefined && was.userTurnId === track.userTurnId;

    // The user's next Turn withdraws the last one's banner.
    if (was !== undefined && track.userTurnId !== null && !sameTurn) close.push(key);
    const completes = sameTurn && was.phase !== "settled" && track.phase === "settled";

    if (!completes || track.done) {
      next.set(key, track);
      continue;
    }

    next.set(key, { ...track, done: true });

    if (notifies({ turn, track, summary, windowFocused, minDurationMs }))
      show.push(contentOf(key, turn));
  }

  // A session that needs you mid-Turn is still in it: keep its track until it goes Idle.
  for (const session of summary.sessions) {
    const key = turnKey(session.hostKey, session.sessionId);
    const was = state.get(key);

    if (was !== undefined && was.phase !== "settled" && !next.has(key)) next.set(key, was);
  }

  return { show, close, state: next };
};

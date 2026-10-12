/**
 * Which Turn-ended notifications to show (Settings → Sessions, off by default): one when a
 * session that was Working is now Idle, never for the session the focused window shows.
 * A Working session's new Turn closes its last one. Pure, so it is unit-tested.
 */
import type { NeedsYouSummary, NeedsYouTurn } from "../../shared/needsYou.ts";
import { notificationKey } from "./plan.ts";

/** Session key → its state at the last summary. */
export type TurnState = ReadonlyMap<string, NeedsYouTurn["state"]>;

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

export const planTurnNotifications = ({
  state,
  summary,
  windowFocused,
}: TurnPlanInput): TurnPlan => {
  const next = new Map<string, NeedsYouTurn["state"]>();
  const show: Array<TurnNotification> = [];
  const close: Array<string> = [];

  for (const turn of summary.turns ?? []) {
    const key = turnKey(turn.hostKey, turn.sessionId);
    const was = state.get(key);

    next.set(key, turn.state);

    if (turn.state === "working") {
      if (was === "idle") close.push(key);
      continue;
    }

    const focused =
      windowFocused &&
      summary.focused?.hostKey === turn.hostKey &&
      summary.focused.sessionId === turn.sessionId;

    if (was === "working" && !focused) show.push(contentOf(key, turn));
  }

  // A session that needs you mid-Turn is still in it: keep it Working until it goes Idle.
  for (const session of summary.sessions) {
    const key = turnKey(session.hostKey, session.sessionId);

    if (state.get(key) === "working" && !next.has(key)) next.set(key, "working");
  }

  return { show, close, state: next };
};

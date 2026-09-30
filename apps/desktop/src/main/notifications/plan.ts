/**
 * Which native notifications to show and close for a Needs You summary: one per session
 * (the newest request replaces the last), never twice for a request, and none for the
 * session the focused window shows. Pure, so it is unit-tested.
 */
import type { NeedsYouRequest, NeedsYouSession, NeedsYouSummary } from "../../shared/needsYou.ts";

export interface NotificationState {
  /** Every live request already notified (or suppressed); pruned as requests resolve. */
  readonly notified: ReadonlySet<string>;
  /** Session key → the request ids its notification covers. */
  readonly shown: ReadonlyMap<string, ReadonlyArray<string>>;
}

export const emptyNotificationState: NotificationState = { notified: new Set(), shown: new Map() };

export interface NotificationContent {
  readonly key: string;
  readonly session: NeedsYouSession;
  /** The newest request, which the notification is about. */
  readonly request: NeedsYouRequest;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  /** Approve / Deny buttons: a single pending approval that isn't a question. */
  readonly actions: boolean;
  /** An inline reply: a single pending question. */
  readonly reply: boolean;
}

export interface NotificationPlan {
  readonly show: ReadonlyArray<NotificationContent>;
  readonly close: ReadonlyArray<string>;
  readonly state: NotificationState;
}

export interface PlanInput {
  readonly state: NotificationState;
  readonly summary: NeedsYouSummary;
  readonly windowFocused: boolean;
}

export const notificationKey = (hostKey: string, sessionId: string) =>
  `${hostKey}\u0000${sessionId}`;

const bodyOf = (request: NeedsYouRequest) =>
  request.detail === null || request.detail === request.title
    ? request.title
    : `${request.title}\n${request.detail}`;

const contentOf = (key: string, session: NeedsYouSession): NotificationContent | null => {
  const request = session.requests.at(-1);

  if (request === undefined) return null;
  const single = session.requests.length === 1;
  const waiting = single ? "" : ` · ${session.requests.length} waiting`;

  return {
    key,
    session,
    request,
    title: `${session.harness} needs you${waiting}`,
    subtitle: `${session.title} · ${session.hostLabel}`,
    body: bodyOf(request),
    actions: single && request.kind !== "question",
    reply: single && request.kind === "question",
  };
};

export const planNotifications = ({
  state,
  summary,
  windowFocused,
}: PlanInput): NotificationPlan => {
  const live = new Set(summary.sessions.flatMap((s) => s.requests.map((r) => r.requestId)));
  const notified = new Set([...state.notified].filter((id) => live.has(id)));
  const shown = new Map(state.shown);
  const show: Array<NotificationContent> = [];
  const close: Array<string> = [];

  for (const session of summary.sessions) {
    const key = notificationKey(session.hostKey, session.sessionId);
    const fresh = session.requests.filter((r) => !notified.has(r.requestId));

    for (const request of fresh) notified.add(request.requestId);

    const focused =
      windowFocused &&
      summary.focused?.hostKey === session.hostKey &&
      summary.focused.sessionId === session.sessionId;

    if (focused && shown.has(key)) {
      close.push(key);
      shown.delete(key);
    }

    if (fresh.length === 0 || focused) continue;
    const content = contentOf(key, session);

    if (content === null) continue;
    show.push(content);
    shown.set(
      key,
      session.requests.map((r) => r.requestId)
    );
  }

  for (const [key, ids] of shown) {
    if (ids.some((id) => live.has(id))) continue;
    close.push(key);
    shown.delete(key);
  }

  return { show, close, state: { notified, shown } };
};

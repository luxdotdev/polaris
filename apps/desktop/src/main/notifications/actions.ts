/**
 * What a notification's click, buttons and reply do, as Needs You actions. The native
 * Notification and the smoke test's probe both call these, so the probe drives the real path.
 * A request is answered once: Windows can deliver one button press twice.
 */
import type { AppEvent } from "../../shared/api.ts";
import type { NeedsYouAction, NeedsYouTurn } from "../../shared/needsYou.ts";
import type { NotificationContent } from "./plan.ts";

/** A Turn-ended banner's click: the Review a Reviewer's or walkthrough's run is for, else the session. */
export const turnClick = (turn: NeedsYouTurn): AppEvent => {
  const target = turn.review?.target ?? null;

  return target === null
    ? { kind: "needs-you", action: "open", hostKey: turn.hostKey, sessionId: turn.sessionId }
    : { kind: "open-review", target };
};

export interface NotificationHandlers {
  readonly click: () => void;
  /** A button by its index: 0 is Approve, 1 is Deny. */
  readonly action: (index: number) => void;
  readonly reply: (text: string) => void;
}

export const NOTIFICATION_BUTTONS = ["Approve", "Deny"] as const;

export const notificationHandlers = (
  content: NotificationContent,
  act: (action: NeedsYouAction) => void
): NotificationHandlers => {
  const { hostKey, sessionId } = content.session;
  const { requestId } = content.request;
  let answered = false;

  const once = (action: NeedsYouAction) => {
    if (answered) return;
    answered = true;
    act(action);
  };

  return {
    click: () => act({ action: "open", hostKey, sessionId }),
    action: (index) =>
      once({ action: index === 0 ? "approve" : "deny", hostKey, sessionId, requestId }),
    reply: (text) => once({ action: "answer", hostKey, sessionId, requestId, text }),
  };
};

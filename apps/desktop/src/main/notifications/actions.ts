/**
 * What a notification's click, buttons and reply do, as Needs You actions. The native
 * Notification and the smoke test's probe both call these, so the probe drives the real path.
 */
import type { NeedsYouAction } from "../../shared/needsYou.ts";
import type { NotificationContent } from "./plan.ts";

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

  return {
    click: () => act({ action: "open", hostKey, sessionId }),
    action: (index) =>
      act({ action: index === 0 ? "approve" : "deny", hostKey, sessionId, requestId }),
    reply: (text) => act({ action: "answer", hostKey, sessionId, requestId, text }),
  };
};

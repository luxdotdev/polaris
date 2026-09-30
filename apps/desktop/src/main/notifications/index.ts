/**
 * Needs You outside the window: native notifications, the menu bar star and the Dock badge,
 * fed by the renderer's summary (`needsYou.publish`). Answers go back to the renderer as app
 * events, which dispatches them like any other, so every answer from this device is one path.
 */
import { app, type BrowserWindow, Notification } from "electron";
import type { AppEvent } from "../../shared/api.ts";
import type { NeedsYouAction, NeedsYouSummary } from "../../shared/needsYou.ts";
import { createStarTray, type StarTray } from "../tray/index.ts";
import {
  emptyNotificationState,
  type NotificationContent,
  notificationKey,
  planNotifications,
} from "./plan.ts";

export interface NeedsYouCenterInput {
  readonly window: () => BrowserWindow | null;
  readonly send: (event: AppEvent) => void;
  /** Off for hidden runs (smoke tests, benchmarks): nothing pops up on the machine. */
  readonly notify: boolean;
}

export interface NeedsYouCenter {
  readonly publish: (summary: NeedsYouSummary) => void;
  readonly dispose: () => void;
}

/** What the smoke test reads from the main process. */
export interface NeedsYouProbe {
  readonly count: () => number;
  readonly trayTitle: () => string;
  /** Every pending request id in the summary. */
  readonly requests: () => ReadonlyArray<string>;
  /** Notifications planned so far (shown, or counted when `notify` is off). */
  readonly notified: () => number;
}

declare global {
  var __polarisNeedsYou: NeedsYouProbe | undefined;
}

export const createNeedsYouCenter = ({
  window,
  send,
  notify,
}: NeedsYouCenterInput): NeedsYouCenter => {
  let state = emptyNotificationState;
  let summary: NeedsYouSummary = { count: 0, sessions: [], focused: null };
  let planned = 0;
  const live = new Map<string, Notification>();

  const focusWindow = () => {
    const win = window();

    if (win === null) return;

    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true });
  };

  const act = (action: NeedsYouAction) => {
    if (action.action === "open") focusWindow();
    send({ kind: "needs-you", ...action });
  };

  const open = (hostKey: string, sessionId: string) => act({ action: "open", hostKey, sessionId });

  const tray: StarTray = createStarTray({
    onOpenSession: (session) => open(session.hostKey, session.sessionId),
    onOpenApp: focusWindow,
    onQuit: () => app.quit(),
  });

  const close = (key: string) => {
    live.get(key)?.close();
    live.delete(key);
  };

  const show = (content: NotificationContent) => {
    planned++;
    close(content.key);

    if (!notify || !Notification.isSupported()) return;
    const { hostKey, sessionId } = content.session;
    const requestId = content.request.requestId;

    const notification = new Notification({
      title: content.title,
      subtitle: content.subtitle,
      body: content.body,
      actions: content.actions
        ? [
            { type: "button", text: "Approve" },
            { type: "button", text: "Deny" },
          ]
        : [],
      hasReply: content.reply,
      replyPlaceholder: "Answer",
    });

    notification.on("click", () => open(hostKey, sessionId));
    notification.on("action", (_event, index) =>
      act({ action: index === 0 ? "approve" : "deny", hostKey, sessionId, requestId })
    );
    notification.on("reply", (_event, text) =>
      act({ action: "answer", hostKey, sessionId, requestId, text })
    );
    notification.on("close", () => {
      if (live.get(content.key) === notification) live.delete(content.key);
    });
    live.set(content.key, notification);
    notification.show();
  };

  const publish = (next: NeedsYouSummary) => {
    summary = next;

    const plan = planNotifications({
      state,
      summary,
      windowFocused: window()?.isFocused() ?? false,
    });

    state = plan.state;

    for (const key of plan.close) close(key);

    for (const content of plan.show) show(content);
    tray.update(summary);
    app.dock?.setBadge(summary.count > 0 ? String(summary.count) : "");
  };

  globalThis.__polarisNeedsYou = {
    count: () => summary.count,
    trayTitle: tray.title,
    requests: () => summary.sessions.flatMap((s) => s.requests.map((r) => r.requestId)),
    notified: () => planned,
  };

  return {
    publish,
    dispose: () => {
      for (const key of live.keys()) close(key);
      tray.destroy();
      globalThis.__polarisNeedsYou = undefined;
    },
  };
};

export { notificationKey };

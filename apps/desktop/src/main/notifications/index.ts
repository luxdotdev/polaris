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
  NOTIFICATION_BUTTONS,
  type NotificationHandlers,
  notificationHandlers,
} from "./actions.ts";
import { focusWindow } from "./focus.ts";
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
  /** Asked before each banner: off when hidden (tests) or switched off in Settings → Sessions. */
  readonly notify: () => boolean;
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
  /** The notifications standing now (shown, or only planned when `notify` is off). */
  readonly standing: () => ReadonlyArray<StandingNotification>;
  /** Presses a standing notification's button (0 Approve, 1 Deny) through its own handler. */
  readonly press: (key: string, index: number) => boolean;
  /** Sends a standing notification's inline reply through its own handler. */
  readonly reply: (key: string, text: string) => boolean;
}

export interface StandingNotification {
  readonly key: string;
  readonly requestId: string;
  readonly actions: boolean;
  readonly reply: boolean;
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
  const standing = new Map<string, { content: NotificationContent; on: NotificationHandlers }>();

  const focus = () => focusWindow(window());

  const act = (action: NeedsYouAction) => {
    if (action.action === "open") focus();
    send({ kind: "needs-you", ...action });
  };

  const open = (hostKey: string, sessionId: string) => act({ action: "open", hostKey, sessionId });

  const tray: StarTray = createStarTray({
    onOpenSession: (session) => open(session.hostKey, session.sessionId),
    onOpenApp: focus,
    onQuit: () => app.quit(),
  });

  const close = (key: string) => {
    live.get(key)?.close();
    live.delete(key);
    standing.delete(key);
  };

  const show = (content: NotificationContent) => {
    planned++;
    close(content.key);
    const on = notificationHandlers(content, act);

    standing.set(content.key, { content, on });

    if (!notify() || !Notification.isSupported()) return;

    const notification = new Notification({
      title: content.title,
      subtitle: content.subtitle,
      body: content.body,
      actions: content.actions
        ? NOTIFICATION_BUTTONS.map((text) => ({ type: "button" as const, text }))
        : [],
      hasReply: content.reply,
      replyPlaceholder: "Answer",
    });

    notification.on("click", on.click);
    notification.on("action", (_event, index) => on.action(index));
    notification.on("reply", (_event, text) => on.reply(text));
    notification.on("close", () => {
      if (live.get(content.key) !== notification) return;
      live.delete(content.key);
      standing.delete(content.key);
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
    standing: () =>
      [...standing.values()].map(({ content }) => ({
        key: content.key,
        requestId: content.request.requestId,
        actions: content.actions,
        reply: content.reply,
      })),
    press: (key, index) => {
      const entry = standing.get(key);

      if (entry === undefined || !entry.content.actions) return false;
      entry.on.action(index);

      return true;
    },
    reply: (key, text) => {
      const entry = standing.get(key);

      if (entry === undefined || !entry.content.reply) return false;
      entry.on.reply(text);

      return true;
    },
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

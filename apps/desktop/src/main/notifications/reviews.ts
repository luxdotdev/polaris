/**
 * Review requests outside the window (ENG-229): a native notification per new entry in the
 * PR list's `requested`, fed straight from the GitHub client. A click opens the pull request
 * in Review (an `open-pull` app event); a request that goes closes its notification.
 */
import { type BrowserWindow, Notification } from "electron";
import type { AppEvent } from "../../shared/api.ts";
import type { GitHubAccountsView, PullListView } from "../../shared/github.ts";
import {
  emptyReviewState,
  planReviewNotifications,
  type ReviewNotification,
} from "./reviewPlan.ts";
import { focusWindow } from "./focus.ts";

export interface ReviewNotifierInput {
  readonly send: (event: AppEvent) => void;
  readonly window: () => BrowserWindow | null;
  /** Asked before each banner: off when hidden (tests) or switched off in Settings → Sessions. */
  readonly notify: () => boolean;
}

export interface ReviewNotifier {
  readonly update: (list: PullListView) => void;
  /** The signed-in accounts, as the GitHub client reports them: each is seen from now on. */
  readonly accounts: (accounts: GitHubAccountsView) => void;
  readonly dispose: () => void;
}

/** What the smoke test reads and drives from the main process. */
export interface ReviewProbe {
  /** Keys of every notification planned so far (shown, or counted when `notify` is off). */
  readonly planned: () => ReadonlyArray<string>;
  /** Clicks a standing notification through its own handler. */
  readonly click: (key: string) => boolean;
}

declare global {
  var __polarisReviews: ReviewProbe | undefined;
}

const pullOf = (content: ReviewNotification) => {
  if (content.pull === null) return null;
  const [owner = "", name = ""] = content.pull.repo.split("/");

  return { repo: { owner, name }, number: content.pull.number, pullId: content.pull.id };
};

export const createReviewNotifier = ({
  send,
  window,
  notify,
}: ReviewNotifierInput): ReviewNotifier => {
  let state = emptyReviewState;
  const seenSince = new Map<number, number>();
  const planned: Array<string> = [];
  const live = new Map<string, Notification>();
  const standing = new Map<string, () => void>();

  const close = (key: string) => {
    live.get(key)?.close();
    live.delete(key);
    standing.delete(key);
  };

  const show = (content: ReviewNotification) => {
    close(content.key);
    planned.push(content.key);

    const click = () => {
      // Hidden runs (the smoke) click through the probe: open the pull request, show nothing.
      if (notify()) focusWindow(window());
      send({ kind: "open-pull", pull: pullOf(content) });
    };

    standing.set(content.key, click);

    if (!notify() || !Notification.isSupported()) return;

    const notification = new Notification({
      title: content.title,
      subtitle: content.subtitle,
      body: content.body,
    });

    notification.on("click", click);
    notification.on("close", () => {
      if (live.get(content.key) !== notification) return;
      live.delete(content.key);
      standing.delete(content.key);
    });
    live.set(content.key, notification);
    notification.show();
  };

  globalThis.__polarisReviews = {
    planned: () => [...planned],
    click: (key) => {
      const click = standing.get(key);

      click?.();

      return click !== undefined;
    },
  };

  return {
    update: (list) => {
      const plan = planReviewNotifications(state, list, (id) => seenSince.get(id) ?? null);

      state = plan.state;

      for (const key of plan.close) close(key);

      for (const content of plan.show) show(content);
    },
    accounts: (view) => {
      const now = Date.now();

      for (const account of view.accounts) {
        if (account.state === "ok" && !seenSince.has(account.id)) seenSince.set(account.id, now);
      }
    },
    dispose: () => {
      for (const key of live.keys()) close(key);
      globalThis.__polarisReviews = undefined;
    },
  };
};

/**
 * What Overview does on GitHub: a review bot's commands (`/review`, `/retry`, `/memory …`)
 * posted as the viewer, and the walkthrough published as an own pull request's description.
 * Which bots the viewer already confirmed is kept on this Mac.
 */
import type { ReviewContext, RiskSummaryId } from "@polaris/protocol";
import { useSyncExternalStore } from "react";
import type { Plain } from "../../../../store/plain.ts";
import type { IpcError, OpenPull } from "../../../../../shared/api.ts";
import { polaris } from "../../../bridge.ts";
import { refusalText } from "../../../session/dispatch.ts";
import { refreshPullDetail } from "../../data/pullDetail.ts";
import type { BotCommand } from "../model/botSummary.ts";

export type Done = { readonly ok: true } | { readonly ok: false; readonly message: string };

type PullRef = Pick<OpenPull, "repo" | "number">;

export interface Poster {
  readonly command: (
    pull: PullRef,
    bot: string,
    command: BotCommand["command"],
    text: string | null
  ) => Promise<Done>;
  readonly publish: (pull: PullRef, pullId: string, body: string, head: string) => Promise<Done>;
  readonly comment: (pull: PullRef, body: string) => Promise<Done>;
}

const done = (
  result: { readonly ok: true } | { readonly ok: false; readonly error: IpcError }
): Done => (result.ok ? { ok: true } : { ok: false, message: refusalText(result.error) });

const ref = (pull: PullRef) => ({ repo: pull.repo, number: pull.number });

/** The main process's GitHub client, as the viewer's account. */
const github: Poster = {
  command: async (pull, bot, command, text) => {
    const input = { pull: ref(pull), bot, command };

    return done(
      await polaris().request("github.bot.command", text === null ? input : { ...input, text })
    );
  },
  publish: async (pull, pullId, body, head) =>
    done(
      await polaris().request("github.pull.publishDescription", {
        pull: ref(pull),
        pullId,
        body,
        head,
      })
    ),
  comment: async (pull, body) =>
    done(await polaris().request("github.pull.comment", { pull: ref(pull), body })),
};

/** The preview swaps in its own. */
export interface PosterSlot {
  current: Poster;
}

export const poster: PosterSlot = { current: github };

export const postBotCommand = async (
  pull: PullRef,
  bot: string,
  command: BotCommand["command"],
  text: string | null = null
): Promise<Done> => {
  const done = await poster.current.command(pull, bot, command, text);

  if (done.ok) await refreshPullDetail(pull);

  return done;
};

export const publishDescription = async (
  pull: PullRef,
  pullId: string,
  body: string,
  head: string
): Promise<Done> => {
  const done = await poster.current.publish(pull, pullId, body, head);

  if (done.ok) await refreshPullDetail(pull);

  return done;
};

/** "Comment now": a top-level comment on the pull request, published at once. */
export const commentNow = async (pull: PullRef, body: string): Promise<Done> => {
  const result = await poster.current.comment(pull, body);

  if (result.ok) await refreshPullDetail(pull);

  return result;
};

const KEY = "polaris.review.confirmedBots";

const read = (): ReadonlyArray<string> => {
  try {
    const raw = localStorage.getItem(KEY);

    return raw === null ? [] : raw.split("\n").filter((b) => b !== "");
  } catch {
    return [];
  }
};

let confirmed = read();

const listeners = new Set<() => void>();

/** The first command to a bot asks; after that it posts at once. */
export const confirmBot = (bot: string) => {
  if (confirmed.includes(bot)) return;
  confirmed = [...confirmed, bot];

  try {
    localStorage.setItem(KEY, confirmed.join("\n"));
  } catch {
    // Private storage: it asks again next launch.
  }

  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const useBotConfirmed = (bot: string) =>
  useSyncExternalStore(subscribe, () => confirmed.includes(bot));

/** The walkthrough's own controls on the Host that holds its Risk Summary. */
export const runWalkthrough = (
  hostKey: string,
  summaryId: RiskSummaryId,
  context: Plain<ReviewContext> | null
) => polaris().request("review.runWalkthrough", { hostKey, summaryId, context });

export const stopWalkthrough = (hostKey: string, summaryId: RiskSummaryId) =>
  polaris().request("review.stopWalkthrough", { hostKey, summaryId });

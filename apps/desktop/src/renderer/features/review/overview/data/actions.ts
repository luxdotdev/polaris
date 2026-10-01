/**
 * What Overview does on GitHub: a review bot's commands (`/review`, `/retry`, `/memory …`)
 * posted as the viewer, and the walkthrough published as an own pull request's description.
 * Which bots the viewer already confirmed is kept on this Mac.
 */
import { useSyncExternalStore } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import { refreshPullDetail } from "../../data/pullDetail.ts";
import type { BotCommand } from "../model/botSummary.ts";

export type Done = { readonly ok: true } | { readonly ok: false; readonly message: string };

type PullRef = Pick<OpenPull, "repo" | "number">;

/** The main process's IPC for these lands with ovbackend's runtime; until then they say so. */
const UNAVAILABLE: Done = { ok: false, message: "This build of Polaris can’t post to GitHub yet" };

export interface Poster {
  readonly command: (
    pull: PullRef,
    bot: string,
    command: BotCommand["command"],
    text: string | null
  ) => Promise<Done>;
  readonly publish: (pull: PullRef, pullId: string, body: string, head: string) => Promise<Done>;
}

const unavailable: Poster = {
  command: () => Promise.resolve(UNAVAILABLE),
  publish: () => Promise.resolve(UNAVAILABLE),
};

/** Swapped by the preview, and by the IPC once it exists. */
export interface PosterSlot {
  current: Poster;
}

export const poster: PosterSlot = { current: unavailable };

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

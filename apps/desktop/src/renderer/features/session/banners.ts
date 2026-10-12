/**
 * The Desktop App's own record of agents' `notify` banners: whether main showed each one, or
 * held it because you were in that session. The Daemon never knows; it lasts across launches.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { BannerRecord } from "./model/polarisTools/index.ts";

const Entry = Schema.Struct({
  hostKey: Schema.String,
  sessionId: Schema.String,
  id: Schema.String,
  title: Schema.String,
  body: Schema.String,
  banner: Schema.Literals(["shown", "here", "off"]),
});

export type BannerEntry = typeof Entry.Type;

const Stored = Schema.fromJsonString(Schema.Array(Entry));

const KEY = "polaris.agentBanners";

/** Enough for every recent session's notifications; the oldest go first. */
const LIMIT = 300;

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const load = (): ReadonlyArray<BannerEntry> => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    return raw === null ? [] : Option.getOrElse(Schema.decodeUnknownOption(Stored)(raw), () => []);
  } catch {
    return [];
  }
};

const store = createStore<{ readonly entries: ReadonlyArray<BannerEntry> }>(() => ({
  entries: load(),
}));

const same = (a: BannerEntry, b: BannerEntry) =>
  a.id === b.id && a.hostKey === b.hostKey && a.sessionId === b.sessionId;

/** The record in an `agent-banner` app event. */
export const bannerEntry = ({
  hostKey,
  sessionId,
  id,
  title,
  body,
  banner,
}: BannerEntry): BannerEntry => ({ hostKey, sessionId, id, title, body, banner });

/** Main decided a banner: record it, once per notification. */
export const recordBanner = (entry: BannerEntry) => {
  const entries = [...store.getState().entries.filter((e) => !same(e, entry)), entry].slice(-LIMIT);

  store.setState({ entries });

  try {
    storage()?.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or off: the record lasts for this launch.
  }
};

export interface BannerQuery {
  readonly hostKey: string;
  readonly sessionId: string;
  readonly title: string;
  readonly body: string;
}

/**
 * The banner a `notify` call made: its notification has the call's title and body in its
 * session (the tool call doesn't carry the notification's id). The latest such wins.
 */
export const bannerFor = (
  entries: ReadonlyArray<BannerEntry>,
  { hostKey, sessionId, title, body }: BannerQuery
): BannerRecord | null =>
  entries.findLast(
    (e) =>
      e.hostKey === hostKey && e.sessionId === sessionId && e.title === title && e.body === body
  )?.banner ?? null;

export const useBanner = (query: BannerQuery | null): BannerRecord | null =>
  useStore(store, (s) => (query === null ? null : bannerFor(s.entries, query)));

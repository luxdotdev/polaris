/**
 * Which Risk Finding a pull request thread answers ("Linked to ▲ …", Paper R6). GitHub keeps
 * no such link, so this device remembers it when a comment drafted from a finding is added,
 * in `localStorage`, bounded to the latest 200 threads.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export interface ThreadLink {
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly title: string;
}

const KEY = "polaris.review.links.v1";

const MAX = 200;

const Stored = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      severity: Schema.Literals(["critical", "high", "medium", "low"]),
      title: Schema.String,
    })
  )
);

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const read = (): Readonly<Record<string, ThreadLink>> => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    return raw === null
      ? {}
      : Option.getOrElse(Schema.decodeUnknownOption(Stored)(raw), () => ({}));
  } catch {
    return {};
  }
};

const links = createStore<Readonly<Record<string, ThreadLink>>>(read);

export const useThreadLink = (threadId: string): ThreadLink | undefined =>
  useStore(links, (s) => s[threadId]);

export const linkThread = (threadId: string, link: ThreadLink) => {
  const kept = Object.entries(links.getState())
    .filter(([id]) => id !== threadId)
    .slice(-(MAX - 1));

  links.setState(Object.fromEntries([...kept, [threadId, link]]), true);

  try {
    storage()?.setItem(KEY, JSON.stringify(links.getState()));
  } catch {
    // Storage full or off: the link lasts for this launch.
  }
};

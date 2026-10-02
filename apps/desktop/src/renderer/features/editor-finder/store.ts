/**
 * Whether ⌘P is open (and with what query), and the files recently opened in the editor per
 * Workspace, kept in localStorage. Every open request (`routes/editor.ts`) counts as opened.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { editorRoute } from "../../routes/editor.ts";
import { withRecent } from "./model.ts";

interface FinderState {
  readonly open: boolean;
  readonly initialQuery: string;
}

export const finderStore = createStore<FinderState>(() => ({ open: false, initialQuery: "" }));

export const useFinder = (): FinderState => useStore(finderStore, (s) => s);

/** Opens ⌘P, optionally with a query (vim's `:e <path>`). */
export const openFileFinder = (initialQuery = "") =>
  finderStore.setState({ open: true, initialQuery });

export const closeFileFinder = () => finderStore.setState({ open: false, initialQuery: "" });

const KEY = "polaris.editor.recent.v1";

const Recent = Schema.Record(Schema.String, Schema.Array(Schema.String));

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(Recent));

const recentKey = (hostKey: string, workspaceId: string) => `${hostKey}\u0000${workspaceId}`;

const load = (): Readonly<Record<string, ReadonlyArray<string>>> => {
  try {
    const raw = localStorage.getItem(KEY);

    return raw === null ? {} : Option.getOrElse(decode(raw), () => ({}));
  } catch {
    return {};
  }
};

export const recentStore = createStore(load);

export const useRecent = (hostKey: string | null, workspaceId: string | null) =>
  useStore(recentStore, (s) =>
    hostKey === null || workspaceId === null ? EMPTY : (s[recentKey(hostKey, workspaceId)] ?? EMPTY)
  );

const EMPTY: ReadonlyArray<string> = [];

editorRoute.subscribe(({ request }, previous) => {
  if (request === null || request.seq === previous.request?.seq) return;
  const key = recentKey(request.hostKey, request.workspaceId);

  recentStore.setState((s) => ({ ...s, [key]: withRecent(s[key] ?? [], request.path) }));

  try {
    localStorage.setItem(KEY, JSON.stringify(recentStore.getState()));
  } catch {
    // Storage full or unavailable: recents last for this launch.
  }
});

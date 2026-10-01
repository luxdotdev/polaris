/**
 * Viewed marks in the renderer. An Agent Session's live in this window's `localStorage`
 * (`model/viewed.ts`: per subject, reset when a file's diff changes); a pull request's are
 * GitHub's, set through `github.files.setViewed`, with the click shown at once and undone
 * if GitHub refuses.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { polaris } from "../../bridge.ts";
import { emptyBook, setViewed, type ViewedBook } from "../model/viewed.ts";

const KEY = "polaris.review.viewed.v1";

const decode = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      subjects: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
      order: Schema.Array(Schema.String),
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

const read = (): ViewedBook => {
  try {
    const raw = storage()?.getItem(KEY) ?? null;

    return raw === null ? emptyBook : Option.getOrElse(decode(raw), () => emptyBook);
  } catch {
    return emptyBook;
  }
};

export interface ViewedState {
  readonly book: ViewedBook;
  /** Pull request clicks GitHub hasn't confirmed yet, by `pullId\u0000path`. */
  readonly pending: ReadonlyMap<string, boolean>;
}

export const viewedStore = createStore<ViewedState>(() => ({ book: read(), pending: new Map() }));

export const useViewed = <A>(select: (state: ViewedState) => A): A => useStore(viewedStore, select);

export const pendingKey = (pullId: string, path: string) => `${pullId}\u0000${path}`;

/** Marks an Agent Session's file; `fingerprint` null clears it. */
export const markLocal = (subject: string, file: string, fingerprint: string | null) => {
  const book = setViewed(viewedStore.getState().book, subject, file, fingerprint);

  viewedStore.setState({ book });

  try {
    storage()?.setItem(KEY, JSON.stringify(book));
  } catch {
    // Storage full or off: the mark lasts for this launch.
  }
};

const withPending = (key: string, viewed: boolean | null) => {
  const pending = new Map(viewedStore.getState().pending);

  if (viewed === null) pending.delete(key);
  else pending.set(key, viewed);

  viewedStore.setState({ pending });
};

export interface PullFileRef {
  readonly pull: {
    readonly repo: { readonly owner: string; readonly name: string };
    readonly number: number;
  };
  readonly pullId: string;
  readonly path: string;
}

/** Marks a pull request's file on GitHub; resolves false (and undoes the click) on refusal. */
export const markPull = async ({ pull, pullId, path }: PullFileRef, viewed: boolean) => {
  const key = pendingKey(pullId, path);

  withPending(key, viewed);

  const result = await polaris().request("github.files.setViewed", { pull, pullId, path, viewed });

  if (!result.ok) withPending(key, null);

  return result.ok;
};

/** A fresh `github.pull.detail`: clicks GitHub now agrees with are settled. */
export const settlePull = (pullId: string, remote: (path: string) => boolean) => {
  const prefix = `${pullId}\u0000`;
  const before = viewedStore.getState().pending;

  const pending = new Map(
    [...before].filter(
      ([key, viewed]) => !key.startsWith(prefix) || remote(key.slice(prefix.length)) !== viewed
    )
  );

  if (pending.size !== before.size) viewedStore.setState({ pending });
};

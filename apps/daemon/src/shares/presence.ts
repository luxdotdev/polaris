/**
 * Who has a shared session or Constellation open right now (`shares.watchPresence`): one
 * viewer per open `subscribeSession` or `constellation.subscribe`, gone when it ends. Never
 * persisted, and nothing polls: the feeds' own lifetimes drive it.
 */
import {
  type Actor,
  shareCovers,
  SharePresenceEntry,
  type ShareTarget,
  type ShareTouch,
} from "@polaris/protocol";
import { Effect, Queue, Stream } from "effect";

export interface Viewer {
  /** One entry per person: a Teammate's issuer and person, or the owner. */
  readonly person: string;
  readonly actor: Actor;
  readonly avatarUrl: string | null;
  readonly touch: ShareTouch;
  readonly since: string;
}

export interface SharePresence {
  /** Records a viewer; the result removes it. */
  readonly enter: (viewer: Viewer) => () => void;
  /** Each person among the viewers `covers` holds for, by their earliest feed still open. */
  readonly list: (covers: (touch: ShareTouch) => boolean) => ReadonlyArray<SharePresenceEntry>;
  /** Calls `listener` when a viewer comes or goes; returns the unsubscribe. */
  readonly watch: (listener: () => void) => () => void;
}

export const sharePresence = (): SharePresence => {
  const viewers = new Set<Viewer>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());

  return {
    enter: (viewer) => {
      viewers.add(viewer);
      changed();

      return () => {
        if (viewers.delete(viewer)) changed();
      };
    },
    list: (covers) => {
      const earliest = new Map<string, Viewer>();

      for (const viewer of viewers) {
        const known = earliest.get(viewer.person);

        if (covers(viewer.touch) && (known === undefined || viewer.since < known.since))
          earliest.set(viewer.person, viewer);
      }

      return [...earliest.values()]
        .toSorted((a, b) => a.since.localeCompare(b.since))
        .map(({ actor, avatarUrl, since }) => new SharePresenceEntry({ actor, avatarUrl, since }));
    },
    watch: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
  };
};

/** Who has `target` open: the list now, then again on each change. */
export const presenceFeed = (presence: SharePresence, target: ShareTarget) =>
  // Sliding by one: a burst of changes reads the list once more, never once per change.
  Stream.callback<void>(
    (queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const unwatch = presence.watch(() => Queue.offerUnsafe(queue, undefined));

          Queue.offerUnsafe(queue, undefined);

          return unwatch;
        }),
        (unwatch) => Effect.sync(unwatch)
      ),
    { bufferSize: 1, strategy: "sliding" }
  ).pipe(Stream.map(() => presence.list((touch) => shareCovers(target, touch))));

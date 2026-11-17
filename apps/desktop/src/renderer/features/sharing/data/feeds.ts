/**
 * Sharing's data from the main process: the Invites and sessions shared with you, who has a
 * session open, and which of your sessions are shared (the people glyph in their rows).
 */
import type { SessionId } from "@polaris/protocol";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PresenceView, SharedWithMeView } from "../../../../shared/sharingContract.ts";
import { useApp } from "../../../shell/hooks.ts";
import { hasBridge, polaris } from "../../bridge.ts";

/** Invites and sessions shared with you; null until the feed's first item. */
export const useSharedWithMe = (): SharedWithMeView | null => {
  const [view, setView] = useState<SharedWithMeView | null>(null);

  useEffect(() => {
    const off = polaris().subscribe(
      "sharing.withMe",
      {},
      {
        items: (items) => {
          const latest = items.at(-1);

          if (latest !== undefined) setView(latest);
        },
      }
    );

    return off;
  }, []);

  return view;
};

/** How a session's names read to whoever is looking (the Comments' `ActorViewer`). */
export interface SessionNames {
  /** The owner's name on a session shared with you; null on your own. */
  readonly owner: string | null;
  /** Your person there, as the Host names your Turns; null on your own Host. */
  readonly selfPersonId: string | null;
}

const OWN_SESSION: SessionNames = { owner: null, selfPersonId: null };

/** How names read in one session: the owner's name and your person when it is shared with you. */
export const actorViewerOf = (
  view: SharedWithMeView | null,
  hostKey: string,
  sessionId: string
): SessionNames => {
  const session = view?.sessions.find((s) => s.hostKey === hostKey && s.sessionId === sessionId);

  if (session === undefined) return OWN_SESSION;

  return {
    owner: session.owner.name ?? `@${session.owner.login}`,
    selfPersonId: session.selfPersonId,
  };
};

const withMe = createStore<{ readonly view: SharedWithMeView | null }>(() => ({ view: null }));

let watching = false;

/** One `sharing.withMe` feed for every name on screen, opened by the first to ask. */
const watchWithMe = () => {
  if (watching || !hasBridge()) return;
  watching = true;
  polaris().subscribe(
    "sharing.withMe",
    {},
    {
      items: (items) => {
        const latest = items.at(-1);

        if (latest !== undefined) withMe.setState({ view: latest });
      },
    }
  );
};

/** Invites and sessions shared with you, from the one feed every surface shares. */
export const useSharedView = (): SharedWithMeView | null => {
  useEffect(watchWithMe, []);

  return useStore(withMe, (s) => s.view);
};

/** Who is reading a session's names: you as its owner, or as a Teammate on someone else's Host. */
export const useActorViewer = (hostKey: string, sessionId: string) => {
  useEffect(watchWithMe, []);
  const view = useStore(withMe, (s) => s.view);

  return useMemo(() => actorViewerOf(view, hostKey, sessionId), [view, hostKey, sessionId]);
};

const NO_ONE: ReadonlyArray<PresenceView> = [];

/** Who has the session open now; empty for a session never shared (the feed then stays quiet). */
export const usePresence = (
  hostKey: string,
  sessionId: SessionId,
  enabled: boolean
): ReadonlyArray<PresenceView> => {
  const key = `${hostKey}\u0000${sessionId}`;
  const [seen, setSeen] = useState({ key, people: NO_ONE });

  useEffect(() => {
    if (!enabled) return undefined;

    return polaris().subscribe(
      "sharing.presence",
      { hostKey, sessionId },
      {
        items: (items) => {
          const latest = items.at(-1);

          if (latest !== undefined)
            setSeen({ key: `${hostKey}\u0000${sessionId}`, people: latest });
        },
      }
    );
  }, [hostKey, sessionId, enabled]);

  // A reading from another session, or from before sharing stopped, doesn't count.
  return enabled && seen.key === key ? seen.people : NO_ONE;
};

interface SharedSessions {
  /** Per Host: the connection epoch it was read at, and the sessions with a live Share. */
  readonly byHost: Readonly<
    Record<string, { readonly epoch: number; readonly ids: ReadonlySet<string> }>
  >;
}

const shared = createStore<SharedSessions>(() => ({ byHost: {} }));

const loading = new Map<string, Promise<void>>();

/** Reads a Host's shared sessions again: after a share or a revoke, and on each connection. */
export const refreshSharedSessions = (hostKey: string, epoch?: number): Promise<void> => {
  const at = epoch ?? shared.getState().byHost[hostKey]?.epoch ?? 0;
  const key = `${hostKey}\u0000${at}`;
  const running = loading.get(key);

  if (running !== undefined && epoch !== undefined) return running;

  const load = polaris()
    .request("sharing.sharedSessions", { hostKey })
    .then((result) => {
      if (!result.ok) return;
      shared.setState((s) => ({
        byHost: { ...s.byHost, [hostKey]: { epoch: at, ids: new Set(result.value) } },
      }));
    })
    .finally(() => loading.delete(key));

  loading.set(key, load);

  return load;
};

/** Whether one of your sessions has a live Share; read once per connection of its Host. */
export const useIsShared = (hostKey: string, sessionId: string): boolean => {
  const epoch = useApp((s) => {
    const host = s.hosts.find((h) => h.key === hostKey);

    return host?.status.state === "connected" ? host.status.epoch : null;
  });

  const known = useStore(shared, (s) => s.byHost[hostKey]);

  useEffect(() => {
    if (epoch !== null && known?.epoch !== epoch) void refreshSharedSessions(hostKey, epoch);
  }, [hostKey, epoch, known?.epoch]);

  return known?.ids.has(sessionId) ?? false;
};

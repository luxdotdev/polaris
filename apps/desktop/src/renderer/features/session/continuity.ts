/**
 * Continuity with the Host (ENG-458): the composer's draft is saved to the
 * Host as it's typed and restored from it, and the last ended Turn shown here
 * becomes the session's read position on every Client. One `continuity` feed
 * per Host while any of its sessions is open.
 */
import { type DraftSync, makeDraftSync } from "@polaris/client/continuity";
import { ContinuityItem, SessionId, type TurnId } from "@polaris/protocol";
import { useEffect } from "react";
import { polaris } from "../bridge.ts";
import { onDraftChange, patchSessionUi, uiKey } from "./state.ts";

interface Held {
  refs: number;
  readonly sync: DraftSync;
  close: () => void;
}

const hosts = new Map<string, Held>();

/** A feed that ended while still held (its connection dropped) opens again after this. */
const REOPEN_MS = 1_000;

/** Set while a Host's draft is put into the composer, so it isn't written straight back. */
let adopting = false;

const open = (hostKey: string, held: Held) => {
  held.close = polaris().subscribe(
    "continuity",
    { hostKey },
    {
      items: (items) => {
        for (const item of items)
          ContinuityItem.match(item, {
            Snapshot: ({ drafts }) => drafts.forEach(held.sync.receive),
            Draft: ({ draft }) => held.sync.receive(draft),
            Read: () => undefined,
          });
      },
      end: () =>
        setTimeout(() => {
          if (hosts.get(hostKey) === held) open(hostKey, held);
        }, REOPEN_MS),
    }
  );
};

const hold = (hostKey: string) => {
  const existing = hosts.get(hostKey);

  if (existing !== undefined) existing.refs++;
  else {
    const sync = makeDraftSync({
      save: async (sessionId, text) => {
        const result = await polaris().request("continuity.saveDraft", {
          hostKey,
          sessionId,
          text,
        });

        return result.ok ? result.value : null;
      },
      adopt: (sessionId, text) => {
        adopting = true;
        patchSessionUi(uiKey(hostKey, sessionId), () => ({ draft: text }));
        adopting = false;
      },
    });

    const held: Held = { refs: 1, sync, close: () => undefined };
    hosts.set(hostKey, held);
    open(hostKey, held);
  }

  return () => {
    const held = hosts.get(hostKey);

    if (held === undefined || --held.refs > 0) return;
    hosts.delete(hostKey);
    held.close();
    held.sync.dispose();
  };
};

// Every change to a draft, typed or cleared on send, goes to its Host while the Host is held.
onDraftChange((key, draft) => {
  if (adopting) return;
  const [hostKey, sessionId] = key.split("\u0000");
  const held = hostKey === undefined ? undefined : hosts.get(hostKey);

  if (held !== undefined && sessionId !== undefined)
    held.sync.edit(SessionId.make(sessionId), draft);
});

/** The last Turn each session told its Host was read, so each is sent once. */
const reported = new Map<string, TurnId>();

const markRead = (hostKey: string, sessionId: SessionId, turnId: TurnId) => {
  const key = uiKey(hostKey, sessionId);

  if (reported.get(key) === turnId) return;
  reported.set(key, turnId);
  void polaris().request("continuity.markRead", { hostKey, sessionId, turnId });
};

/**
 * Keeps the Host's draft and read position in step with the open session:
 * `lastEnded` is the newest ended Turn on screen, read once the window is visible.
 */
export const useSessionContinuity = (options: {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly enabled: boolean;
  readonly lastEnded: TurnId | null;
}) => {
  const { hostKey, sessionId, enabled, lastEnded } = options;

  useEffect(() => {
    if (!enabled) return;
    const release = hold(hostKey);

    // Leaving the session writes what's still pending at once.
    return () => {
      void hosts.get(hostKey)?.sync.flush(sessionId);
      release();
    };
  }, [hostKey, sessionId, enabled]);

  useEffect(() => {
    if (!enabled || lastEnded === null) return;

    const report = () => {
      if (document.visibilityState === "visible") markRead(hostKey, sessionId, lastEnded);
    };

    report();
    document.addEventListener("visibilitychange", report);

    return () => document.removeEventListener("visibilitychange", report);
  }, [hostKey, sessionId, enabled, lastEnded]);
};

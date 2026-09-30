/** The session view's reads: the open session, its Host, a clock. */
import type { Capability, SessionId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { HostView } from "../../../shared/api.ts";
import { emptySessionModel, type SessionModel } from "../../store/sessionModel.ts";
import { sessionKey } from "../../store/store.ts";
import { useApp, useSessionFeed } from "../../shell/hooks.ts";

/** Keeps the session's feed open and returns its model (empty until the Snapshot lands). */
export const useSession = (hostKey: string, sessionId: SessionId): SessionModel => {
  useSessionFeed(hostKey, sessionId);

  return useApp((s) => s.sessions[sessionKey(hostKey, sessionId)]) ?? emptySessionModel;
};

export const useHost = (hostKey: string): HostView | undefined =>
  useApp((s) => s.hosts.find((h) => h.key === hostKey));

export const hasCapability = (host: HostView | undefined, capability: Capability) =>
  host?.status.capabilities.includes(capability) ?? false;

/** Milliseconds since `since`, ticking once a second while `running`. */
export const useElapsed = (since: string | null, running: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [running]);

  return since === null ? 0 : Math.max(0, now - Date.parse(since));
};

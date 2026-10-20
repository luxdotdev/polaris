import type { SessionId } from "@polaris/protocol";
import { createContext, useContext } from "react";

/** The session a row belongs to, for what an item alone can't say (a `notify` banner's record). */
export interface SessionTarget {
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

export const SessionTargetContext = createContext<SessionTarget | null>(null);

export const useSessionTarget = (): SessionTarget | null => useContext(SessionTargetContext);

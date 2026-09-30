/** React access to the store: the connection in context, slices through selectors. */
import { createContext, useContext, useEffect } from "react";
import type { SessionId } from "@polaris/protocol";
import { useStore } from "zustand";
import type { AppState, Connection } from "../store/store.ts";

const ConnectionContext = createContext<Connection | null>(null);

export const ConnectionProvider = ConnectionContext.Provider;

export const useConnection = (): Connection => {
  const connection = useContext(ConnectionContext);

  if (connection === null) throw new Error("useConnection outside ConnectionProvider");

  return connection;
};

/** Re-renders only when the selected slice changes (by `Object.is`). */
export const useApp = <A>(select: (state: AppState) => A): A =>
  useStore(useConnection().store, select);

/** Keeps an Agent Session's feed open while the component is mounted. */
export const useSessionFeed = (hostKey: string, sessionId: SessionId | null) => {
  const { openSession } = useConnection();

  useEffect(
    () => (sessionId === null ? undefined : openSession(hostKey, sessionId)),
    [openSession, hostKey, sessionId]
  );
};

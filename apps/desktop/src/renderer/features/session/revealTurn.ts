/**
 * A request to bring one Turn of a session into view when its conversation shows (the
 * editor's Origins card opens a session at the Turn that wrote a line). The Transcript takes it.
 */
import type { SessionId, TurnId } from "@polaris/protocol";
import { createStore } from "zustand/vanilla";

export interface TurnRequest {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
}

export const turnRequests = createStore<{ readonly pending: TurnRequest | null }>(() => ({
  pending: null,
}));

export const requestTurn = (request: TurnRequest) => turnRequests.setState({ pending: request });

/** Taken once revealed, so going back to the session later doesn't scroll again. */
export const takeTurn = (request: TurnRequest) => {
  if (turnRequests.getState().pending === request) turnRequests.setState({ pending: null });
};

/**
 * Showing and hiding Output for a session. A showing terminal drawer keeps
 * Output open, so hiding Output hides the drawer too (its terminals run on).
 */
import {
  hideTerminal,
  isTerminalShown,
  type TerminalPlace,
  useTerminalShown,
} from "../../terminal/index.ts";
import { uiKey } from "../state.ts";
import { isOutputOpen, openForEdit, setOutputOpen, useOutputOpen } from "./open.ts";

export const hideOutput = (place: TerminalPlace, sessionId: string) => {
  setOutputOpen(uiKey(place.hostKey, sessionId), false);
  hideTerminal(place);
};

/** Opens Output unless the user has chosen for this session (a Lead's Constellation tab). */
export const offerOutput = (hostKey: string, sessionId: string) =>
  openForEdit(uiKey(hostKey, sessionId));

export const showOutput = (place: TerminalPlace, sessionId: string) =>
  setOutputOpen(uiKey(place.hostKey, sessionId), true);

export const toggleOutput = (place: TerminalPlace, sessionId: string) => {
  const shown =
    isOutputOpen(uiKey(place.hostKey, sessionId)) ||
    isTerminalShown(place.hostKey, place.workspaceId);

  if (shown) hideOutput(place, sessionId);
  else setOutputOpen(uiKey(place.hostKey, sessionId), true);
};

/** Whether Output shows as a panel (else the rail). */
export const useOutputShown = (place: TerminalPlace, sessionId: string): boolean => {
  const open = useOutputOpen(uiKey(place.hostKey, sessionId));
  const terminal = useTerminalShown(place.hostKey, place.workspaceId);

  return open || terminal;
};

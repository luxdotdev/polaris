/**
 * Showing and hiding Output for a session. A showing terminal drawer keeps
 * Output open, so hiding Output tucks the drawer to its strip (Edit still shows it).
 */
import {
  isTerminalShown,
  type TerminalPlace,
  tuckTerminal,
  useTerminalShown,
} from "../../terminal/index.ts";
import { showSubagent, uiKey } from "../state.ts";
import { isOutputOpen, openForEdit, setOutputOpen, useOutputOpen } from "./open.ts";

export const hideOutput = (place: TerminalPlace, sessionId: string) => {
  setOutputOpen(uiKey(place.hostKey, sessionId), false);
  tuckTerminal(place);
};

/** Opens Output unless the user has chosen for this session (a Lead's Constellation tab). */
export const offerOutput = (hostKey: string, sessionId: string) =>
  openForEdit(uiKey(hostKey, sessionId));

export const showOutput = (place: TerminalPlace, sessionId: string) =>
  setOutputOpen(uiKey(place.hostKey, sessionId), true);

/** Opens Output on a Subagent's tab: its transcript, live. */
export const openSubagent = (place: TerminalPlace, sessionId: string, subagentId: string) => {
  showSubagent(uiKey(place.hostKey, sessionId), subagentId);
  showOutput(place, sessionId);
};

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

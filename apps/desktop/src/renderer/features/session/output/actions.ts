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
import { getSessionUi, setOutputOpen, uiKey, useSessionUi } from "../state.ts";

export const hideOutput = (place: TerminalPlace, sessionId: string) => {
  setOutputOpen(uiKey(place.hostKey, sessionId), false);
  hideTerminal(place);
};

export const toggleOutput = (place: TerminalPlace, sessionId: string) => {
  const shown =
    getSessionUi(uiKey(place.hostKey, sessionId)).outputOpen ||
    isTerminalShown(place.hostKey, place.workspaceId);

  if (shown) hideOutput(place, sessionId);
  else setOutputOpen(uiKey(place.hostKey, sessionId), true);
};

/** Whether Output shows as a panel (else the rail). */
export const useOutputShown = (place: TerminalPlace, sessionId: string): boolean => {
  const open = useSessionUi(uiKey(place.hostKey, sessionId)).outputOpen;
  const terminal = useTerminalShown(place.hostKey, place.workspaceId);

  return open || terminal;
};

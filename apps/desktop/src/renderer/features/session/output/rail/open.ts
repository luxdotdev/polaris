/** The rail's ways into the panel: Changes for the whole session, at a file or at the top. */
import { setDataOutputShown } from "../../../data/output/index.ts";
import { setTracesOutputShown } from "../../../traces/output/index.ts";
import { revealFile, showSubagent, showTurnDiff, uiKey } from "../../state.ts";
import { leaveBrowser } from "../browser.ts";
import { setOutputOpen } from "../open.ts";
import { leaveSimulator } from "../simulator.ts";

const showChanges = (hostKey: string, sessionId: string) => {
  const key = uiKey(hostKey, sessionId);

  showSubagent(key, null);
  leaveBrowser(hostKey, sessionId);
  leaveSimulator(hostKey, sessionId);
  setDataOutputShown(key, false);
  setTracesOutputShown(key, false);
  showTurnDiff(key, null);
};

/** Opens Output on the whole session's Changes. */
export const openChanges = (hostKey: string, sessionId: string) => {
  showChanges(hostKey, sessionId);
  setOutputOpen(uiKey(hostKey, sessionId), true);
};

/** Opens Output on the whole session's Changes, scrolled to `path`. */
export const openAtFile = (hostKey: string, sessionId: string, path: string) => {
  showChanges(hostKey, sessionId);
  revealFile(uiKey(hostKey, sessionId), path);
  setOutputOpen(uiKey(hostKey, sessionId), true);
};

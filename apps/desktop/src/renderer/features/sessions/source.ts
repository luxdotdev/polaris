/**
 * The Constellation read model for the shell's parts: `features/constellation` owns it (C1-U1);
 * this module keeps the names shellui's views import, without pulling in the tab's UI.
 */
export {
  focusTask,
  unfocusTask,
  useAllConstellations,
  useConstellationActions,
  useConstellations,
  useFocusedTask,
  useLeadConstellation,
  useWorkerAttempt,
  type WorkerAttempt,
} from "../constellation/hooks.ts";

export type { ConstellationView } from "../constellation/model/types.ts";

export {
  currentSetup,
  retrySetup,
  type SetupFact,
  setupExit,
  setupOutcome,
  setupSources,
  setupsOf,
} from "../constellation/model/setup.ts";

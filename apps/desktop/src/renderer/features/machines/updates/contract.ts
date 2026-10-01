/** `MachineView.daemon` and its parts (`src/shared/daemonUpdates.ts`), as this feature names them. */
import type { DaemonUpdateResult } from "../../../../shared/daemonUpdates.ts";

export type {
  DaemonUpdateProgress,
  DaemonUpdateResult,
  DaemonUpdateView,
} from "../../../../shared/daemonUpdates.ts";

export type DaemonUpdateProblem = NonNullable<DaemonUpdateResult["problem"]>;

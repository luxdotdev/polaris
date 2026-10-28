/**
 * A constellation row's task counts. S4's constellation feed (`useConstellation`, `taskBar`)
 * supplies them; until it is merged the row shows the lead without a bar.
 */
import type { ConstellationProgress } from "../model/taskBar.ts";

export const useConstellationProgress = (
  _hostId: string,
  _constellationId: string
): ConstellationProgress | null => null;

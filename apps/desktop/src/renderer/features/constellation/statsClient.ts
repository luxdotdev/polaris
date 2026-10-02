/**
 * The one `constellation.stats` client: the tab's Stats popover and completion card and
 * Usage → By constellation all ask through it, cached per graph revision. Never polled.
 */
import type { ConstellationId } from "@polaris/protocol";
import type { ConstellationStatsView, Result } from "../../../shared/api.ts";
import { polaris } from "../bridge.ts";

const cache = new Map<string, Promise<Result<ConstellationStatsView>>>();

/** The Stats of a graph at a revision, from its Lead's Host; a failure is asked again next time. */
export const askStats = (
  hostKey: string,
  constellationId: ConstellationId,
  revision: number
): Promise<Result<ConstellationStatsView>> => {
  const key = `${hostKey}\u0000${constellationId}\u0000${revision}`;
  const known = cache.get(key);

  if (known !== undefined) return known;

  const asked = polaris()
    .request("constellation.stats", { hostKey, constellationId })
    .then((result) => {
      if (!result.ok) cache.delete(key);

      return result;
    });

  cache.set(key, asked);

  return asked;
};

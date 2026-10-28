/**
 * A constellation row's task counts, from S4's constellation feed and its task bar. Only a row on
 * screen follows the feed; one scrolled away keeps its last counts and closes its subscription.
 */
import { constellationView, useConstellation } from "../../constellation/index.ts";
import { useHost } from "../../runtime/hosts.tsx";
import { type ConstellationProgress, progressOf } from "../model/taskBar.ts";

export const useConstellationProgress = (
  hostId: string,
  constellationId: string,
  onScreen: boolean
): ConstellationProgress | null => {
  const host = useHost(hostId);
  const feed = useConstellation(onScreen ? host : null, constellationId);

  return feed.kind === "live" ? progressOf(constellationView(feed.source, Date.now()).bar) : null;
};

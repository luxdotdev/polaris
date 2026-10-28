/** A constellation row's task counts, from S4's constellation feed and its task bar. */
import { constellationView, useConstellation } from "../../constellation/index.ts";
import { useHost } from "../../runtime/hosts.tsx";
import { type ConstellationProgress, progressOf } from "../model/taskBar.ts";

export const useConstellationProgress = (
  hostId: string,
  constellationId: string
): ConstellationProgress | null => {
  const feed = useConstellation(useHost(hostId), constellationId);

  return feed.kind === "live" ? progressOf(constellationView(feed.source, Date.now()).bar) : null;
};

import { useMemo } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { useAllConstellations } from "../../sessions/source.ts";
import { workerQueue, type WorkerQueue } from "./claims.ts";

/** Workers' Claims in review and every worker session, across every Host. */
export const useWorkerQueue = (): WorkerQueue => {
  const views = useAllConstellations();
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => workerQueue(views, hosts, models), [views, hosts, models]);
};

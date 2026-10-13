/**
 * What the card asks for only while it's open (DESIGN.md, Performance: nothing polls while it's
 * closed): the model server behind the target, and its memory on this machine.
 */
import type { PredictionServerAction, PredictionServerReport } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { PolarisApi } from "../../../../../shared/api.ts";
import { memoryLine } from "../../../settings/editor/placementRows.ts";
import type { CardTarget } from "./model.ts";

const keyOf = (target: CardTarget) =>
  JSON.stringify([target.side, target.endpoint.kind, target.endpoint.url, target.model]);

export const serverRequest = (
  api: PolarisApi,
  hostKey: string,
  target: CardTarget,
  action: PredictionServerAction | null
) =>
  api
    .request("prediction.server", {
      hostKey,
      side: target.side,
      endpoint: target.endpoint,
      model: target.model,
      action,
    })
    .then((result) => {
      if (!result.ok) throw new Error(result.error.message);

      return result.value;
    });

/** The server report for the open card's target; `revision` asks again (after Check again). */
export const useServerReport = (
  api: PolarisApi,
  hostKey: string,
  target: CardTarget | null,
  open: boolean,
  revision: number
) => {
  const [report, setReport] = useState<{
    readonly key: string;
    readonly value: PredictionServerReport;
  } | null>(null);

  const key = target === null ? null : keyOf(target);

  useEffect(() => {
    if (!open || target === null || key === null) return;
    let live = true;

    // A server that can't be identified offers no recovery; the card then gives advice instead.
    void serverRequest(api, hostKey, target, null)
      .catch((): PredictionServerReport => ({ kind: "unknown", actions: [], outcome: null }))
      .then((value) => {
        if (live) setReport({ key, value });
      });

    return () => {
      live = false;
    };
    // Keyed on `key`: a new object for the same target asks nothing new.
  }, [api, hostKey, key, open, revision]);

  return {
    report: report !== null && report.key === key ? report.value : null,
    remember: (value: PredictionServerReport) => {
      if (key !== null) setReport({ key, value });
    },
  };
};

/** Settings' memory line for the model servers on this machine, read when the card opens. */
export const useMemoryLine = (
  api: PolarisApi,
  open: boolean,
  wanted: boolean,
  clientName: string
) => {
  const [memory, setMemory] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !wanted) return;
    let live = true;

    void api.request("prediction.resources.get", {}).then((result) => {
      if (live && result.ok) setMemory(memoryLine(result.value, clientName));
    });

    return () => {
      live = false;
    };
  }, [api, open, wanted, clientName]);

  return memory;
};

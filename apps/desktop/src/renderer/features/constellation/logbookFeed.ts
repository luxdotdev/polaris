/**
 * A Logbook's live feed (`constellation.logbook.subscribe`) while the Logbook tab shows it: its
 * first page, then a page per change, merged. A new connection epoch reads it again.
 */
import type { ConstellationId, TaskId } from "@polaris/protocol";
import { useEffect, useState } from "react";
import type { IpcError } from "../../../shared/api.ts";
import { useApp } from "../../shell/hooks.ts";
import type { AppState } from "../../store/store.ts";
import { polaris } from "../bridge.ts";
import { emptyLog, type LogbookLog, mergePage } from "./model/logbook.ts";

export type LogbookFeed =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly log: LogbookLog }
  | { readonly kind: "failed"; readonly error: IpcError }
  /** The Lead's Host is connected but its Daemon has no Logbook. */
  | { readonly kind: "unsupported" }
  | { readonly kind: "offline" };

type Reach = "live" | "unsupported" | "offline";

const statusOf = (s: AppState, hostKey: string) => s.hosts.find((h) => h.key === hostKey)?.status;

/** Whether the Lead's Host can serve its Logbook now. */
const reachOf =
  (hostKey: string) =>
  (s: AppState): Reach => {
    const status = statusOf(s, hostKey);

    if (status?.state !== "connected") return "offline";

    return status.capabilities.includes("constellation.logbook") ? "live" : "unsupported";
  };

/** The connection epoch a read belongs to; a new one reads the Logbook again. */
const epochOf = (hostKey: string) => (s: AppState) => {
  const status = statusOf(s, hostKey);

  return status?.state === "connected" ? status.epoch : -1;
};

interface Read {
  readonly key: string;
  readonly feed: LogbookFeed;
}

export const useLogbook = (
  hostKey: string,
  constellationId: ConstellationId,
  taskId: TaskId | null
): LogbookFeed => {
  const reach = useApp(reachOf(hostKey));
  const epoch = useApp(epochOf(hostKey));
  const key = `${hostKey}\u0000${constellationId}\u0000${taskId ?? ""}\u0000${epoch}`;
  const [read, setRead] = useState<Read>({ key: "", feed: { kind: "loading" } });

  useEffect(() => {
    if (reach !== "live") return;

    let log = emptyLog;

    const input =
      taskId === null ? { hostKey, constellationId } : { hostKey, constellationId, taskId };

    return polaris().subscribe("constellation.logbook", input, {
      items: (pages) => {
        log = pages.reduce(mergePage, log);
        setRead({ key, feed: { kind: "ready", log } });
      },
      end: (error) => {
        if (error !== null) setRead({ key, feed: { kind: "failed", error } });
      },
    });
  }, [hostKey, constellationId, taskId, reach, key]);

  if (reach !== "live") return { kind: reach };

  return read.key === key ? read.feed : { kind: "loading" };
};

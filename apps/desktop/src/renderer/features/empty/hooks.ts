/** Reads the empty states share. */
import type { HostView } from "../../../shared/api.ts";
import { useAvailability } from "../harness/index.ts";
import { readyLine } from "./model.ts";

/** "Claude Code 2.1.4 and Codex 0.52.0 are ready on Mac Studio", once the Host has answered. */
export const useReadyLine = (host: HostView) => {
  const { options, loading } = useAvailability(host.key);
  const ready = options.filter((o) => o.status === "ready");

  if (host.status.state !== "connected") return `Once ${host.label} is connected`;

  return loading ? `Checking harnesses on ${host.label}…` : readyLine(ready, host.label);
};

/** Reads the empty states share. */
import type { HostView } from "../../../shared/api.ts";
import { useHarnessOptions } from "../session/hooks.ts";
import { readyLine } from "./model.ts";

/** "Claude Code and Codex are ready on Mac Studio", once the Host has answered. */
export const useReadyLine = (host: HostView) => {
  const { options, loading } = useHarnessOptions(host.key);
  const ready = options.filter((o) => o.status === "ready").map((o) => o.name);

  return loading ? `Checking harnesses on ${host.label}…` : readyLine(ready, host.label);
};

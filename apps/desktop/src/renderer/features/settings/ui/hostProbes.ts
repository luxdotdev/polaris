/**
 * Each Host's Harness availability for Settings, from the Harness feature's
 * live feeds (`harness.watchAvailability`), so Settings and the pickers agree.
 * After a sign-in terminal exits, `refresh` probes that Host again.
 */
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import { refreshAvailability, useAvailabilityReports } from "../../harness/index.ts";
import type { HostProbe, ProbedHost } from "../model/harnesses.ts";

const canWatch = (host: HostView) =>
  host.status.state === "connected" && host.status.capabilities.includes("harness.availability");

const staticProbe = (host: HostView): HostProbe | null => {
  if (host.status.state !== "connected") return { kind: "offline" };

  return canWatch(host) ? null : { kind: "unsupported" };
};

export const useHostProbes = () => {
  const hosts = useApp((s) => s.hosts);
  const reports = useAvailabilityReports(hosts.filter(canWatch).map((h) => h.key));

  const probed: ReadonlyArray<ProbedHost> = hosts.map((host) => {
    const report = reports[host.key];

    return {
      hostKey: host.key,
      label: host.label,
      probe:
        staticProbe(host) ??
        (report === undefined ? { kind: "checking" } : { kind: "reported", report }),
    };
  });

  return { hosts: probed, refresh: (hostKey: string) => void refreshAvailability(hostKey) };
};

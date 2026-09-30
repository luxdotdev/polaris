/**
 * Each Host's Harness availability for Settings: asked once per Host when it
 * connects (answered from the Daemon's cache), and again with `refresh` after
 * a sign-in terminal exits.
 */
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import type { HostProbe, ProbedHost } from "../model/harnesses.ts";

type Probes = Readonly<Record<string, HostProbe>>;

const canAsk = (host: HostView) =>
  host.status.state === "connected" && host.status.capabilities.includes("harness.availability");

const staticProbe = (host: HostView): HostProbe | null => {
  if (host.status.state !== "connected") return { kind: "offline" };

  return canAsk(host) ? null : { kind: "unsupported" };
};

const ask = (hostKey: string, refresh: boolean, setProbes: Dispatch<SetStateAction<Probes>>) =>
  void window.polaris.request("harness.availability", { hostKey, refresh }).then((result) => {
    const probe: HostProbe = result.ok
      ? { kind: "reported", report: result.value }
      : { kind: "failed", message: result.error.message };

    setProbes((p) => ({ ...p, [hostKey]: probe }));
  });

export const useHostProbes = () => {
  const hosts = useApp((s) => s.hosts);
  const [probes, setProbes] = useState<Probes>({});
  const asked = useRef(new Set<string>());

  const askable = hosts
    .filter(canAsk)
    .map((h) => h.key)
    .join("\u0000");

  useEffect(() => {
    for (const hostKey of askable === "" ? [] : askable.split("\u0000")) {
      if (asked.current.has(hostKey)) continue;
      asked.current.add(hostKey);
      ask(hostKey, false, setProbes);
    }
  }, [askable]);

  const probed: ReadonlyArray<ProbedHost> = hosts.map((host) => ({
    hostKey: host.key,
    label: host.label,
    probe: staticProbe(host) ?? probes[host.key] ?? { kind: "checking" },
  }));

  return { hosts: probed, refresh: (hostKey: string) => ask(hostKey, true, setProbes) };
};

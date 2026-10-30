/**
 * Keeps every connected Host's Visuals setting equal to the user's (Settings → Sessions,
 * ENG-598): one setting for all Hosts, written to each when it changes and when a Host connects.
 * It reads the Host's copy first and writes only when it differs.
 */
import type { VisualsLevel } from "@polaris/protocol";
import { useEffect } from "react";
import { useApp } from "../../shell/hooks.ts";
import { polaris } from "../bridge.ts";
import { useSettings } from "./store.ts";

/** What was last written per Host and connection, so a re-render doesn't write again. */
const written = new Map<string, VisualsLevel>();

/** True when the Host holds `level` afterwards. */
export const syncHostVisuals = async (hostKey: string, level: VisualsLevel): Promise<boolean> => {
  const current = await polaris().request("sessions.visuals", { hostKey });

  if (current.ok && current.value.level === level) return true;
  const set = await polaris().request("sessions.setVisuals", { hostKey, settings: { level } });

  return set.ok;
};

/** Mounted once in the app; idle unless the user's setting or the connected Hosts change. */
export const VisualsPublisher = () => {
  const hosts = useApp((s) => s.hosts);
  const level = useSettings((s) => s.sessions.visuals);
  // Empty until main has answered: the setting before that is the built-in one, not the user's.
  const loaded = useSettings((s) => s.version !== "");

  useEffect(() => {
    if (!loaded) return;

    for (const host of hosts) {
      if (host.status.state !== "connected") continue;

      if (!host.status.capabilities.includes("sessions.visuals")) continue;
      const key = `${host.key}\u0000${host.status.epoch}`;

      if (written.get(key) === level) continue;
      written.set(key, level);
      // Tried again on the next change or connection.
      void syncHostVisuals(host.key, level).then((ok) => ok || written.delete(key));
    }
  }, [hosts, level, loaded]);

  return null;
};

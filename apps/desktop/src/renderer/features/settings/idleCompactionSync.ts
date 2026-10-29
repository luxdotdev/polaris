/**
 * Keeps every connected Host's idle compaction setting equal to the user's (Settings →
 * Sessions, ENG-562): one setting for all Hosts, kept here and written to each when it changes
 * and when a Host connects. It reads the Host's copy first and writes only when it differs.
 */
import { useEffect } from "react";
import type { IdleCompactionPref } from "../../../shared/contract.ts";
import { useApp } from "../../shell/hooks.ts";
import { polaris } from "../bridge.ts";
import { useSettings } from "./store.ts";

/** What was last written per Host and connection, so a re-render doesn't write again. */
const written = new Map<string, string>();

const sameSetting = (host: IdleCompactionPref, user: IdleCompactionPref) =>
  host.enabled === user.enabled && host.minTokens === user.minTokens;

const syncHost = async (key: string, hostKey: string, user: IdleCompactionPref) => {
  const current = await polaris().request("sessions.idleCompaction", { hostKey });

  if (current.ok && sameSetting(current.value, user)) return;
  const set = await polaris().request("sessions.setIdleCompaction", { hostKey, settings: user });

  // Tried again on the next change or connection.
  if (!set.ok) written.delete(key);
};

/** Mounted once in the app; idle unless the user's setting or the connected Hosts change. */
export const IdleCompactionPublisher = () => {
  const hosts = useApp((s) => s.hosts);
  const user = useSettings((s) => s.sessions.idleCompaction);
  // Empty until main has answered: the setting before that is the built-in one, not the user's.
  const loaded = useSettings((s) => s.version !== "");

  useEffect(() => {
    if (!loaded) return;
    const wanted = JSON.stringify(user);

    for (const host of hosts) {
      if (host.status.state !== "connected") continue;

      if (!host.status.capabilities.includes("sessions.idle-compaction")) continue;
      const key = `${host.key}\u0000${host.status.epoch}`;

      if (written.get(key) === wanted) continue;
      written.set(key, wanted);
      void syncHost(key, host.key, user);
    }
  }, [hosts, user, loaded]);

  return null;
};

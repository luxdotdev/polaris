/**
 * Hosts as the screens show them: one that dropped less than the grace period ago still
 * reads as connected, so a brief reconnect doesn't dim Home (ENG-498).
 */
import { useEffect, useRef, useState } from "react";
import type { HomeHost } from "../model/home.ts";
import { RECONNECT_GRACE_MS } from "../../runtime/useAfter.ts";

export interface SettledHosts {
  readonly hosts: ReadonlyArray<HomeHost>;
  /** When the next Host in its grace period starts to show as away; null when none is. */
  readonly nextAt: number | null;
}

/** Each Host's state as shown, given when each first went away. */
export const settledHosts = (
  hosts: ReadonlyArray<HomeHost>,
  awaySince: ReadonlyMap<string, number>,
  now: number,
  grace: number = RECONNECT_GRACE_MS
): SettledHosts => {
  let nextAt: number | null = null;

  const shown = hosts.map((host) => {
    const since = awaySince.get(host.hostId);

    if (host.connection === "connected" || since === undefined || now - since >= grace) return host;

    nextAt = Math.min(nextAt ?? Number.POSITIVE_INFINITY, since + grace);

    return { ...host, connection: "connected" as const };
  });

  // Unchanged Hosts keep their identity, so screens' memos over them hold.
  return { hosts: nextAt === null ? hosts : shown, nextAt };
};

/** Remembers when each Host went away, and re-renders when a grace period runs out. */
export const useSettledHosts = (hosts: ReadonlyArray<HomeHost>): ReadonlyArray<HomeHost> => {
  const awaySince = useRef(new Map<string, number>());
  const [now, setNow] = useState(() => Date.now());

  const at = Date.now();

  for (const host of hosts) {
    if (host.connection === "connected") awaySince.current.delete(host.hostId);
    else if (!awaySince.current.has(host.hostId)) awaySince.current.set(host.hostId, at);
  }

  const settled = settledHosts(hosts, awaySince.current, Math.max(now, at));

  useEffect(() => {
    if (settled.nextAt === null) return;

    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, settled.nextAt - Date.now()));

    return () => clearTimeout(timer);
  }, [settled.nextAt]);

  return settled.hosts;
};

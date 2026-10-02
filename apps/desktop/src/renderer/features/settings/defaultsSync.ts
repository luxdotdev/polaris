/**
 * Keeps every connected Host's Constellation defaults equal to the user's (Settings →
 * Constellations): when the user changes them, and when a Host connects. It reads the Host's
 * copy first and writes only when it differs, keeping the Host's other settings.
 */
import { useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { ConstellationDefaults } from "../../../shared/contract.ts";
import { useApp } from "../../shell/hooks.ts";
import { polaris } from "../bridge.ts";
import { type HostSync, inSync, withUserDefaults } from "./model/constellationDefaults.ts";
import { useSettings } from "./store.ts";

/** Each Host's copy, by Host key, for Settings to show. */
export const defaultsSync = createStore<Readonly<Record<string, HostSync>>>(() => ({}));

export const useDefaultsSync = () => useStore(defaultsSync, (s) => s);

const mark = (hostKey: string, sync: HostSync) =>
  defaultsSync.setState((s) => ({ ...s, [hostKey]: sync }));

/** What was last written per Host and connection, so a re-render doesn't write again. */
const written = new Map<string, string>();

const syncHost = async (hostKey: string, user: ConstellationDefaults) => {
  mark(hostKey, "saving");
  const current = await polaris().request("constellation.defaults.get", { hostKey });

  if (!current.ok) return mark(hostKey, "failed");

  if (inSync(current.value.settings, user)) return mark(hostKey, "saved");
  const settings = withUserDefaults(current.value.settings, user);
  const set = await polaris().request("constellation.defaults.set", { hostKey, settings });

  mark(hostKey, set.ok ? "saved" : "failed");
};

/** Mounted once in the app; idle unless the user's defaults or the connected Hosts change. */
export const ConstellationDefaultsPublisher = () => {
  const hosts = useApp((s) => s.hosts);
  const user = useSettings((s) => s.sessions.constellationDefaults);
  // Empty until main has answered: the defaults before that are the built-in ones, not the user's.
  const loaded = useSettings((s) => s.version !== "");

  useEffect(() => {
    if (!loaded) return;
    const wanted = JSON.stringify(user);

    for (const host of hosts) {
      if (host.status.state !== "connected") continue;

      if (!host.status.capabilities.includes("constellation.defaults")) {
        mark(host.key, "older-daemon");
        continue;
      }

      const key = `${host.key}\u0000${host.status.epoch}`;

      if (written.get(key) === wanted) continue;
      written.set(key, wanted);
      void syncHost(host.key, user);
    }
  }, [hosts, user, loaded]);

  return null;
};

/**
 * Fixture Hosts for screenshots and break-ui, in a development build launched with
 * `-polarisDevHosts paper|worst|offline|one|huge|empty`, switched from the Hosts screen's toggle.
 * `-polarisDevHostSheet <id>` opens that Host's details sheet.
 */
import { Schema } from "effect";
import { useMemo, useSyncExternalStore } from "react";
import { Platform, Settings } from "react-native";
import type { HostInput } from "./model.ts";
import { devHosts, type DevHostsData } from "./worstCase.testing.ts";

export const DevHosts = Schema.Literals(["paper", "worst", "offline", "one", "huge", "empty"]);

export type { DevHostsData };

const launched = (key: string): string | null => {
  if (!__DEV__ || Platform.OS !== "ios") return null;
  const value: unknown = Settings.get(key);

  return Schema.is(Schema.String)(value) ? value : null;
};

const LAUNCHED_AT = Date.now();

const LAUNCHED: DevHostsData | null = (() => {
  const value = launched("polarisDevHosts");

  return Schema.is(DevHosts)(value) ? value : null;
})();

let chosen: DevHostsData | null = LAUNCHED;

const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const chooseDevHosts = (data: DevHostsData) => {
  chosen = data;

  for (const listener of listeners) listener();
};

export const useDevHostsData = (): DevHostsData | null =>
  useSyncExternalStore(subscribe, () => chosen);

/** The fixture Hosts, or null in a release build or a normal launch. */
export const useDevHosts = (): ReadonlyArray<HostInput> | null => {
  const data = useDevHostsData();

  return useMemo(() => (data === null ? null : devHosts(data, LAUNCHED_AT)), [data]);
};

/** The Host whose sheet opens on launch. */
export const DEV_HOST_SHEET: string | null =
  LAUNCHED === null ? null : launched("polarisDevHostSheet");

/**
 * The Hosts Home and the needs you inbox read: the followed feeds as settled, or in a development
 * build a worst-case dataset chosen with `-polarisDevHomeData` and switched from Home's toggle.
 */
import { Schema } from "effect";
import { useMemo, useSyncExternalStore } from "react";
import { Platform, Settings } from "react-native";
import type { HomeHost } from "../model/home.ts";
import { devHomeHosts } from "../worstCase.testing.ts";
import { useSettledHosts } from "./settled.ts";
import { homeHostsOf, useFollowedHosts } from "./useFollowedHosts.ts";

export const DevHomeData = Schema.Literals([
  "live",
  "worst",
  "empty",
  "one",
  "huge",
  "paper",
  "none",
  "offline",
  "unreachable",
]);

export type DevHomeData = typeof DevHomeData.Type;

const launched = (): DevHomeData | null => {
  if (!__DEV__ || Platform.OS !== "ios") return null;
  const value: unknown = Settings.get("polarisDevHomeData");

  return Schema.is(DevHomeData)(value) ? value : null;
};

const LAUNCHED = launched();

let chosen: DevHomeData = LAUNCHED ?? "live";

const listeners = new Set<() => void>();

/** False outside a development build launched with `-polarisDevHomeData`: no toggle. */
export const devHomeDataOn = (): boolean => LAUNCHED !== null;

export const chooseDevHomeData = (data: DevHomeData) => {
  chosen = data;

  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

export const useDevHomeData = (): DevHomeData => useSyncExternalStore(subscribe, () => chosen);

export const useHomeHosts = (): ReadonlyArray<HomeHost> => {
  const hosts = useFollowedHosts();
  const live = useSettledHosts(useMemo(() => homeHostsOf(hosts), [hosts]));
  const data = useDevHomeData();

  return data === "live" ? live : devHomeHosts[data];
};

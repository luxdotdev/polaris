/**
 * One `constellation` feed per known graph on a connected Host: its Snapshot brings the
 * Daemon's projections (stale, fetched, liveness), its events fold idempotently with the Host's.
 */
import type { ConstellationId } from "@polaris/protocol";
import { useEffect, useMemo } from "react";
import { useApp, useConnection } from "../../shell/hooks.ts";
import type { AppState, AppStore } from "../../store/store.ts";
import { polaris } from "../bridge.ts";
import { applyStreamItems, emptyConstellations } from "./model/index.ts";

interface Wanted {
  readonly key: string;
  readonly hostKey: string;
  readonly constellationId: ConstellationId;
}

/** Live graphs on connected Hosts that speak Constellations, keyed by connection epoch. */
const wantedOf = (state: AppState): string =>
  state.hosts
    .flatMap((host) => {
      const { status } = host;

      if (status.state !== "connected" || !status.capabilities.includes("constellation")) return [];

      return [...(state.constellations[host.key]?.byId.values() ?? [])].flatMap((r) =>
        r.constellation.state === "archived"
          ? []
          : [`${host.key}\u0001${r.constellation.id}\u0001${status.epoch}`]
      );
    })
    .toSorted()
    .join("\u0002");

const parse = (print: string): ReadonlyArray<Wanted> =>
  print === ""
    ? []
    : print.split("\u0002").map((key) => {
        const [hostKey = "", id = ""] = key.split("\u0001");

        // SAFETY: the id was read from a folded Constellation, so it is a ConstellationId.
        return { key, hostKey, constellationId: id as ConstellationId };
      });

/** The feed ends when the connection drops; the next epoch subscribes again. */
const subscribe = (store: AppStore, w: Wanted) =>
  polaris().subscribe(
    "constellation",
    { hostKey: w.hostKey, constellationId: w.constellationId, afterSequence: null },
    {
      items: (items) =>
        store.setState((s) => ({
          constellations: {
            ...s.constellations,
            [w.hostKey]: applyStreamItems(
              s.constellations[w.hostKey] ?? emptyConstellations,
              items
            ),
          },
        })),
    }
  );

/** Mounted once in the app; renders nothing. */
export const ConstellationFeeds = () => {
  const { store } = useConnection();
  const print = useApp(wantedOf);
  const wanted = useMemo(() => parse(print), [print]);

  useEffect(() => {
    const offs = wanted.map((w) => subscribe(store, w));

    return () => {
      for (const off of offs) off();
    };
  }, [store, wanted]);

  return null;
};

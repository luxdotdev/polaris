/** Machines already carry Upgrade outcomes; captions expire once, without idle polling. */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@polaris/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { HostView, MachineView } from "../../../../shared/api.ts";
import { useApp, useNav } from "../../../shell/hooks.ts";
import { useMachines } from "../hooks.tsx";
import {
  type StoppedDaemon,
  stopCaption,
  stopHover,
  UPGRADE_CAPTION_MS,
  upgradeCaption,
  upgradeHover,
} from "./quiet.ts";
import { readSeenStops, writeSeenStops } from "./seenStops.ts";

interface UpgradeStatusState {
  readonly machines: ReadonlyArray<MachineView>;
  readonly opened: Readonly<Record<string, number>>;
  /** Each Host whose Daemon replaced one stopped on purpose (`HostInfo.previousStop`). */
  readonly stops: Readonly<Record<string, StoppedDaemon>>;
  /** The stop each Host's note was seen for, kept across launches. */
  readonly seenStops: Readonly<Record<string, string>>;
  readonly now: number;
}

const statusStore = createStore<UpgradeStatusState>(() => ({
  machines: [],
  opened: {},
  stops: {},
  seenStops: readSeenStops(),
  now: Date.now(),
}));

export const acknowledgeUpgrade = (hostKey: string) =>
  statusStore.setState((state) => {
    const stop = state.stops[hostKey]?.stop.at;
    const opened = { ...state.opened, [hostKey]: Date.now() };

    if (stop === undefined || state.seenStops[hostKey] === stop) return { opened };
    const seenStops = { ...state.seenStops, [hostKey]: stop };
    writeSeenStops(seenStops);

    return { opened, seenStops };
  });

/** The connected Hosts whose `hello` says the previous Daemon was stopped. */
const stoppedDaemons = (hosts: ReadonlyArray<HostView>): Record<string, StoppedDaemon> =>
  Object.fromEntries(
    hosts.flatMap((h) => {
      const info = h.status.host;

      return info?.previousStop === undefined
        ? []
        : [[h.key, { stop: info.previousStop, version: info.daemonVersion }]];
    })
  );

const expiry = (at: number, now: number) =>
  [at + UPGRADE_CAPTION_MS, at + 24 * UPGRADE_CAPTION_MS].filter((t) => t > now);

/** When a caption or hover expires: one timer each, never a poll. */
const expirations = (
  machines: ReadonlyArray<MachineView>,
  stops: Readonly<Record<string, StoppedDaemon>>,
  now: number
) => [
  ...machines.flatMap((m) => {
    const last = m.daemon?.lastUpdate;

    return last?.result === "updated" ? expiry(last.at, now) : [];
  }),
  ...Object.values(stops).flatMap((s) => expiry(Date.parse(s.stop.at), now)),
];

/** Republishes only when a stop changes, not on every Host update (latency, state). */
const useStopsPublisher = () => {
  const hosts = useApp((s) => s.hosts);

  useEffect(() => {
    const stops = stoppedDaemons(hosts);

    if (JSON.stringify(stops) !== JSON.stringify(statusStore.getState().stops))
      statusStore.setState({ stops });
  }, [hosts]);
};

export const UpgradeStatusPublisher = () => {
  const machines = useMachines();
  const hostKey = useNav((s) => s.hostKey);
  const stops = useStore(statusStore, (s) => s.stops);
  useStopsPublisher();
  useEffect(() => {
    if (hostKey !== null) acknowledgeUpgrade(hostKey);
  }, [hostKey]);
  useEffect(() => {
    const now = Date.now();
    statusStore.setState({ machines: machines ?? [], now });
    const due = expirations(machines ?? [], stops, now);

    if (due.length === 0) return undefined;

    const timers = [...new Set(due)].map((at) =>
      setTimeout(() => statusStore.setState({ now: Date.now() }), at - now)
    );

    return () => timers.forEach(clearTimeout);
  }, [machines, stops]);

  return null;
};

export const useUpgradeClock = () => useStore(statusStore, (s) => s.now);

export const useUpgradeCaption = (hostKey: string): string | null =>
  useStore(
    statusStore,
    (s) =>
      stopCaption(s.stops[hostKey] ?? null, s.seenStops[hostKey], s.now) ??
      upgradeCaption(
        s.machines.find((m) => m.key === hostKey)?.daemon?.lastUpdate ?? null,
        s.opened[hostKey],
        s.now
      )
  );

export const UpgradeHover = ({
  hostKey,
  children,
}: {
  readonly hostKey: string;
  readonly children: ReactNode;
}) => {
  const last = useStore(
    statusStore,
    (s) => s.machines.find((m) => m.key === hostKey)?.daemon?.lastUpdate ?? null
  );

  const stopped = useStore(statusStore, (s) => s.stops[hostKey] ?? null);
  const [now, setNow] = useState(() => Date.now());
  // A stop says what this upgrade cost (terminals ended), so it wins over "kept working".
  const note = stopHover(stopped, now) ?? upgradeHover(last, now);

  if (note === null) return children;

  return (
    <HoverCard
      onOpenChange={(open) => {
        if (open) setNow(Date.now());
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-[340px]">
        <div className="p-panel flex flex-col gap-1.5" data-testid="upgrade-note">
          <p className="text-label text-text-default">{note.title}</p>
          <p className="text-caption text-text-subtle">{note.body}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

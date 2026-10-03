/** Machines already carry Upgrade outcomes; captions expire once, without idle polling. */
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@polaris/ui";
import { type ReactNode, useEffect, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { MachineView } from "../../../../shared/api.ts";
import { useNav } from "../../../shell/hooks.ts";
import { useMachines } from "../hooks.tsx";
import { UPGRADE_CAPTION_MS, upgradeCaption, upgradeHover } from "./quiet.ts";

interface UpgradeStatusState {
  readonly machines: ReadonlyArray<MachineView>;
  readonly opened: Readonly<Record<string, number>>;
  readonly now: number;
}

const statusStore = createStore<UpgradeStatusState>(() => ({
  machines: [],
  opened: {},
  now: Date.now(),
}));

export const acknowledgeUpgrade = (hostKey: string) =>
  statusStore.setState((state) => ({ opened: { ...state.opened, [hostKey]: Date.now() } }));

export const UpgradeStatusPublisher = () => {
  const machines = useMachines();
  const hostKey = useNav((s) => s.hostKey);
  useEffect(() => {
    if (hostKey !== null) acknowledgeUpgrade(hostKey);
  }, [hostKey]);
  useEffect(() => {
    const now = Date.now();
    statusStore.setState({ machines: machines ?? [], now });

    const expirations = (machines ?? []).flatMap((m) => {
      const last = m.daemon?.lastUpdate;

      return last?.result === "updated"
        ? [last.at + UPGRADE_CAPTION_MS, last.at + 24 * UPGRADE_CAPTION_MS].filter((at) => at > now)
        : [];
    });

    if (expirations.length === 0) return undefined;

    const timers = [...new Set(expirations)].map((at) =>
      setTimeout(() => statusStore.setState({ now: Date.now() }), at - now)
    );

    return () => timers.forEach(clearTimeout);
  }, [machines]);

  return null;
};

export const useUpgradeClock = () => useStore(statusStore, (s) => s.now);

export const useUpgradeCaption = (hostKey: string): string | null =>
  useStore(statusStore, (s) =>
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

  const [now, setNow] = useState(() => Date.now());
  const note = upgradeHover(last, now);

  if (note === null) return children;

  return (
    <HoverCard
      onOpenChange={(open) => {
        if (open) setNow(Date.now());
      }}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-[340px]">
        <div className="flex flex-col gap-1.5">
          <p className="text-label text-text-default">{note.title}</p>
          <p className="text-caption text-text-subtle">{note.body}</p>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

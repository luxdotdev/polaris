/** Quiet Upgrade notes: one hour in the machine bar, one day in Hosts. */
import type { DaemonUpdateResult } from "../../../../shared/daemonUpdates.ts";

export const UPGRADE_CAPTION_MS = 60 * 60 * 1000;

export const upgradeCaption = (
  last: DaemonUpdateResult | null,
  openedAt: number | undefined,
  now: number
): string | null => {
  if (
    last?.result !== "updated" ||
    last.version === null ||
    now - last.at >= UPGRADE_CAPTION_MS ||
    (openedAt !== undefined && openedAt >= last.at)
  )
    return null;

  return `Upgraded to ${last.version}`;
};

export const upgradeHover = (
  last: DaemonUpdateResult | null,
  now: number
): { readonly title: string; readonly body: string } | null => {
  if (
    last?.result !== "updated" ||
    last.version === null ||
    now - last.at >= 24 * UPGRADE_CAPTION_MS
  )
    return null;
  const minutes = Math.floor(Math.max(0, now - last.at) / 60_000);

  const ago =
    minutes < 1
      ? "just now"
      : minutes < 60
        ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`;

  return {
    title: `Daemon upgraded to ${last.version} · ${ago}`,
    body: `${last.from === null ? "Upgraded" : `From ${last.from}`}, to match this Mac. Agent sessions kept working.`,
  };
};

/**
 * A Host's Connection State, inline and never modal (Paper 5PM-1, DESIGN.md
 * S4): the label says the state and how long in `text-subtle`, the Host's own
 * chips dim instead (rule/remote-is-normal), and the sidebar says what
 * happened in words, never the client's raw error.
 */
import { Button, HostStateChip } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { HostView } from "../../shared/api.ts";
import { hostSentence, isSlowLink } from "./hostCopy.ts";
import { useShellActions } from "./hooks.ts";

const SECOND = 1000;

/** The time, ticking once a second only while `active`. */
const useTicking = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return undefined;
    // Mounted long before (while connected): catch up at once, not a second later.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), SECOND);

    return () => clearInterval(timer);
  }, [active]);

  return now;
};

export const elapsedLabel = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / SECOND));

  if (seconds < 60) return `${seconds}s`;

  return seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;
};

/** "09:14": when a Host went offline. */
export const clockLabel = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** How long or since when, for the state chip; nothing while connected or needing attention. */
export const useSince = (host: HostView): string | undefined => {
  const { state, since } = host.status;
  const now = useTicking(state === "reconnecting");

  if (state === "reconnecting") return elapsedLabel(now - since);

  return state === "offline" ? clockLabel(since) : undefined;
};

export interface HostLabelProps {
  readonly host: HostView;
  /** Needs Attention opens the Host (the sidebar says what happened and how to fix it). */
  readonly onOpen: () => void;
}

/** The Host's label in the Workspace bar: "Linux VM · reconnecting 12s", or the attention chip. */
export const HostBarLabel = ({ host, onOpen }: HostLabelProps) => {
  const since = useSince(host);

  return (
    <HostStateChip
      host={host.label}
      state={host.status.state}
      since={since}
      onOpen={onOpen}
      data-testid={`connection-${host.key}`}
      data-state={host.status.state}
    />
  );
};

const stateCaption = (host: HostView, since: string | undefined): string | null => {
  const { state } = host.status;

  if (state === "reconnecting") return `Reconnecting ${since ?? ""}`;

  if (state === "offline") return `Offline since ${since ?? ""}`;

  if (state === "needs-attention") return "Needs attention";

  return isSlowLink(host) ? "Slow link" : null;
};

/** A machine chip's caption when the state, not the Workspace count, is the news. */
export const HostStateCaption = ({ host }: { readonly host: HostView }) => {
  const since = useSince(host);
  const text = stateCaption(host, since);

  if (text === null) return null;

  return (
    <span
      className="text-caption text-text-subtle"
      data-testid={`connection-${host.key}`}
      data-state={isSlowLink(host) ? "slow-link" : host.status.state}
    >
      {text.trim()}
    </span>
  );
};

/** Under the sidebar header while the Host isn't connected: what happened, and the one fix. */
export const HostStateNote = ({ host }: { readonly host: HostView }) => {
  const { openSettings } = useShellActions();
  const since = useSince(host);

  if (host.status.state === "connected") return null;

  return (
    <div className="flex flex-col items-start gap-2" data-testid="host-state-note">
      <p className="text-caption text-text-subtle">{hostSentence(host, since)}</p>
      {host.status.state === "needs-attention" ? (
        <Button size="sm" onClick={() => openSettings("hosts")}>
          Fix in Settings
        </Button>
      ) : null}
    </div>
  );
};

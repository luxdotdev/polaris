/**
 * A Host's Connection State, inline and never modal (Paper 5PM-1, DESIGN.md
 * S4): the label says the state and how long in `text-subtle`, the Host's own
 * chips dim instead (rule/remote-is-normal), and the sidebar says what
 * happened in words, never the client's raw error.
 */
import {
  Button,
  cn,
  HostStateChip,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type IconProps,
} from "@polaris/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { HostView } from "../../shared/api.ts";
import { call } from "../features/machines/hooks.tsx";
import { hostSentence, isSlowLink } from "./hostCopy.ts";
import { useApp, useShellActions } from "./hooks.ts";
import { clockLabel, elapsedLabel, type OfflineRow, offlineView } from "./offline.ts";

export { clockLabel, elapsedLabel };

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

// ── Offline indicator (X1, X2; Paper 9, 9b) ─────────────────────────────────

/** Crossed-out Wi-Fi in the chrome's outline style, `text-subtle`: offline is neutral, not Failed. */
const WifiOffIcon = ({ size = 16, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1}
    strokeLinecap="round"
    aria-hidden="true"
    focusable="false"
    {...props}
  >
    <path d="M1.8 6.1a8.8 8.8 0 0 1 12.4 0M4.1 8.5a5.5 5.5 0 0 1 7.8 0M6.3 10.9a2.4 2.4 0 0 1 3.4 0" />
    <circle cx="8" cy="13.1" r="0.9" fill="currentColor" stroke="none" />
    <path d="M2.5 2.5l11 11" />
  </svg>
);

/** The OS's network state and when it last went offline, shared by every reader. */
const network = (() => {
  let snapshot = { online: navigator.onLine, since: navigator.onLine ? null : Date.now() };
  const listeners = new Set<() => void>();

  const update = () => {
    const online = navigator.onLine;

    if (online === snapshot.online) return;
    snapshot = { online, since: online ? null : Date.now() };

    for (const l of listeners) l();
  };

  return {
    get: () => snapshot,
    subscribe: (listener: () => void) => {
      if (listeners.size === 0) {
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size > 0) return;
        window.removeEventListener("online", update);
        window.removeEventListener("offline", update);
      };
    },
  };
})();

const DOT: Record<OfflineRow["state"], string> = {
  reconnecting: "border-text-subtle border",
  offline: "border-text-subtle border border-dashed",
  "needs-attention": "border-text-subtle border",
};

const HostRow = ({ row }: { readonly row: OfflineRow }) => {
  const { openSettings } = useShellActions();
  const attention = row.state === "needs-attention";

  return (
    <div
      className="hover:bg-fill-hover flex h-10 items-center gap-2 pr-2 pl-3"
      data-testid={`offline-row-${row.key}`}
      data-state={row.state}
    >
      <span className={cn("size-2 shrink-0 rounded-full", DOT[row.state])} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text-default truncate">{row.label}</span>
        <span className="text-caption text-text-subtle tabular truncate">{row.caption}</span>
      </span>
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0"
        onClick={() =>
          attention ? openSettings("hosts") : void call("host.retryNow", { hostKey: row.key })
        }
      >
        {attention ? "Open" : "Retry"}
      </Button>
    </div>
  );
};

const HOVER_OPEN_MS = 300;

const HOVER_CLOSE_MS = 150;

/**
 * Beside the jump trigger while this Mac is offline or cut off from every remote Host.
 * Hover shows how long and each Host's retry; a click opens it for the keyboard.
 */
export const OfflineIndicator = () => {
  const hosts = useApp((s) => s.hosts);
  const net = useSyncExternalStore(network.subscribe, network.get);
  const [open, setOpen] = useState(false);
  // Ticks only while the card is open: an offline Host can stay offline for days.
  const now = useTicking(open);
  const byHover = useRef(false);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const view = offlineView({ hosts, online: net.online, offlineSince: net.since, now });

  const later = (next: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(next), ms);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  if (view === null) return null;

  const hover = {
    onPointerEnter: () => {
      if (open) return clearTimeout(timer.current);
      byHover.current = true;
      later(true, HOVER_OPEN_MS);
    },
    // A card opened by a click or the keyboard stays until Escape or a click outside.
    onPointerLeave: () => (byHover.current ? later(false, HOVER_CLOSE_MS) : undefined),
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={view.title}
          data-testid="offline-indicator"
          data-reason={view.reason}
          className="app-no-drag rounded-control text-text-subtle hover:bg-fill-hover data-[state=open]:bg-fill-hover flex size-7 shrink-0 cursor-default items-center justify-center"
          onClick={(event) => {
            clearTimeout(timer.current);

            // Clicking a card hover opened pins it instead of closing it.
            if (open && byHover.current) event.preventDefault();

            byHover.current = false;
          }}
          {...hover}
        >
          <WifiOffIcon />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={4}
        className="rounded-control w-[320px] px-0 pt-2.5 pb-1.5"
        ref={card}
        data-testid="offline-card"
        onOpenAutoFocus={(event) => {
          event.preventDefault();

          // Opened by a click or the keyboard: start on the first Retry.
          if (!byHover.current)
            requestAnimationFrame(() => card.current?.querySelector("button")?.focus());
        }}
        {...hover}
      >
        <div className="flex flex-col gap-0.5 px-3 pb-2">
          <span className="text-body text-text-strong tabular font-medium">{view.title}</span>
          <span className="text-caption text-text-subtle">{view.caption}</span>
        </div>
        {view.rows.length === 0 ? null : (
          <div className="border-hairline border-t">
            {view.rows.map((row) => (
              <HostRow key={row.key} row={row} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

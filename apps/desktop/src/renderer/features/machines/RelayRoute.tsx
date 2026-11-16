/**
 * The host page's Polaris Relay route (Paper HS-D; D2, D2b; ENG-461, ENG-948): off until
 * the user turns it on, with Polaris Cloud's relay or their own. Linked devices reach the host through it.
 */
import { POLARIS_CLOUD_RELAY_URL } from "@polaris/protocol";
import { Input, SettingsButton, Switch } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { RelayRouteView } from "../../../shared/linkedDevicesContract.ts";
import { polaris } from "../bridge.ts";
import { call } from "./hooks.tsx";
import { type Flow, FlowLine } from "./page/FlowLine.tsx";

const devices = (n: number) => `${n} device${n === 1 ? "" : "s"}`;

/** The relay the route uses when on, or would use when turned on; "" while your own is unset. */
export const relayAddress = (route: RelayRouteView | null, own: boolean, draft: string): string => {
  if (route?.state === "on") return route.url ?? "";

  return own ? draft.trim() : POLARIS_CLOUD_RELAY_URL;
};

/** Whether a stored URL is the user's own relay rather than Polaris Cloud's; none is Cloud. */
export const isOwnRelay = (url: string | null): boolean =>
  url !== null && url !== POLARIS_CLOUD_RELAY_URL;

const CLOUD = "Polaris Cloud";

/** The line under the name: which relay, whether it's connected, or what turning it on needs. */
export const relayStatusLine = (
  route: RelayRouteView | null,
  own: boolean,
  draft: string,
  linked: number
): string => {
  if (route === null) return "Checking…";

  if (route.state === "on") {
    const state = route.connected ? `Connected · ${devices(linked)}` : "Connecting…";

    return isOwnRelay(route.url) ? state : `${state} · ${CLOUD}`;
  }

  if (!own) return `Off · ${CLOUD}`;

  return draft.trim() === "" ? "Add a relay to turn it on" : "Off";
};

export interface RelayRouteRowProps {
  readonly hostLabel: string;
  readonly route: RelayRouteView | null;
  readonly linked: number;
  /** The user's own relay is chosen instead of Polaris Cloud's. */
  readonly own: boolean;
  readonly draft: string;
  readonly busy: boolean;
  readonly onOwn: (own: boolean) => void;
  readonly onDraft: (url: string) => void;
  readonly onChange: (on: boolean) => void;
}

const flowOf = (route: RelayRouteView | null): Flow => {
  if (route?.state !== "on") return "off";

  return route.connected ? "live" : "connecting";
};

/** While off: Polaris Cloud's relay with a way to your own, or your own's URL with a way back. */
const RelayChoice = ({
  own,
  draft,
  busy,
  onOwn,
  onDraft,
}: Pick<RelayRouteRowProps, "own" | "draft" | "busy" | "onOwn" | "onDraft">) => (
  <div className="flex flex-col items-start gap-1.5">
    {own ? (
      <Input
        aria-label="Relay URL"
        className="text-code-inline font-mono"
        value={draft}
        placeholder="wss://relay.example.com/v1"
        disabled={busy}
        onChange={(event) => onDraft(event.target.value)}
      />
    ) : null}
    <SettingsButton
      variant="ghost"
      className="h-6 px-2"
      disabled={busy}
      onClick={() => onOwn(!own)}
    >
      {own ? "Use Polaris Cloud" : "Use your own relay"}
    </SettingsButton>
  </div>
);

/** Paper HS-D's row: the flow line, "Polaris Relay" over its mono state, and the switch. */
export const RelayRouteRow = ({
  hostLabel,
  route,
  linked,
  own,
  draft,
  busy,
  onOwn,
  onDraft,
  onChange,
}: RelayRouteRowProps) => {
  const on = route?.state === "on";
  const line = relayStatusLine(route, own, draft, linked);

  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5" data-testid="relay-route">
      <div className="flex items-center gap-2.5">
        <FlowLine flow={flowOf(route)} via="relay" />
        <div
          className="flex min-w-0 flex-1 flex-col"
          title={`Your phone reaches ${hostLabel} from anywhere. The relay passes encrypted traffic it can't read.`}
        >
          <span className="text-body text-text-default">Polaris Relay</span>
          <span
            className="text-text-subtle truncate font-mono text-[10px] leading-[14px] uppercase"
            title={line}
          >
            {line}
          </span>
        </div>
        <Switch
          aria-label="Polaris Relay"
          checked={on}
          disabled={busy || route === null || (!on && own && draft.trim() === "")}
          onCheckedChange={onChange}
        />
      </div>
      {on || route === null ? null : (
        <RelayChoice own={own} draft={draft} busy={busy} onOwn={onOwn} onDraft={onDraft} />
      )}
    </div>
  );
};

/** How often a route that's on but not yet connected is read again. */
const connectingPollMs = 2_000;

/** Read when shown; turning it on sends the URL in the field, and a refusal toasts. */
export const useRelayRoute = (hostKey: string, pollMs = connectingPollMs) => {
  const [route, setRoute] = useState<RelayRouteView | null>(null);
  const [linked, setLinked] = useState(0);
  const [own, setOwn] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;

    setRoute(null);
    void Promise.all([
      polaris().request("relayRoute.status", { hostKey }),
      polaris().request("devices.list", { hostKey }),
    ]).then(([status, list]) => {
      if (!active) return;

      if (status.ok) {
        setRoute(status.value);
        setOwn(isOwnRelay(status.value.url));
        setDraft(isOwnRelay(status.value.url) ? (status.value.url ?? "") : "");
      }

      if (list.ok) setLinked(list.value.filter((d) => d.unlinkedAt === null).length);
    });

    return () => {
      active = false;
    };
  }, [hostKey]);

  const connecting = route?.state === "on" && !route.connected;

  // The Daemon dials the relay after it answers, so "Connecting…" is read again until it connects.
  useEffect(() => {
    if (!connecting) return;

    let active = true;

    const timer = setInterval(() => {
      void polaris()
        .request("relayRoute.status", { hostKey })
        .then((status) => {
          if (active && status.ok) setRoute(status.value);
        });
    }, pollMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [connecting, hostKey, pollMs]);

  const change = async (on: boolean) => {
    setBusy(true);

    try {
      const next = on
        ? await call("relayRoute.enable", {
            hostKey,
            url: own ? draft.trim() : POLARIS_CLOUD_RELAY_URL,
          })
        : await call("relayRoute.disable", { hostKey });

      if (next !== null) setRoute(next);
    } finally {
      setBusy(false);
    }
  };

  return {
    route,
    linked,
    own,
    draft,
    busy,
    onOwn: setOwn,
    onDraft: setDraft,
    onChange: (on: boolean) => void change(on),
  };
};

export const RelayRoute = ({
  hostKey,
  hostLabel,
  pollMs,
}: {
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly pollMs?: number;
}) => <RelayRouteRow hostLabel={hostLabel} {...useRelayRoute(hostKey, pollMs)} />;

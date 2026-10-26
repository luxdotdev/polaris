/**
 * Hosts: every pairing, grouped by Host, with how its connection stands. Each
 * pairing gets a client of its own, so one route's failure shows on that route.
 */
import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  Keyboard,
  List,
  LocalStorage,
} from "@raycast/api";
import { createPolaris, type HostInfo, type HostView, type PolarisClient } from "@polaris/sdk";
import { useCallback, useEffect, useState } from "react";
import { AddPairingForm } from "./components/AddPairingForm.tsx";
import { CONNECTION_LABEL, connectionState } from "./lib/connection.ts";
import { describeFailure } from "./lib/copy.ts";
import { readPairings, removePairing, type StoredPairing } from "./lib/pairings.ts";
import { CLIENT_NAME } from "./polaris.tsx";

interface RouteState {
  readonly view: HostView | null;
  readonly info: HostInfo | null;
}

const ICON = {
  connected: Icon.Wifi,
  reconnecting: Icon.ArrowClockwise,
  "needs-attention": Icon.Warning,
  offline: Icon.WifiDisabled,
} as const;

/** Follows one pairing until the component unmounts or the list reloads. */
const followPairing = (
  stored: StoredPairing,
  update: (token: string, state: Partial<RouteState>) => void
) => {
  const { token, hostId } = stored.pairing;
  let client: PolarisClient | null = null;
  let closed = false;

  void (async () => {
    client = await createPolaris({ pairings: [stored.pairing], clientName: CLIENT_NAME });

    if (closed) return client.close();
    client.connect(hostId).then(
      (info) => update(token, { info }),
      () => undefined
    );

    for await (const [view] of client.subscribeHosts()) {
      if (closed) break;

      if (view !== undefined) update(token, { view });
    }
  })();

  return () => {
    closed = true;
    void client?.close();
  };
};

const usePairings = () => {
  const [pairings, setPairings] = useState<ReadonlyArray<StoredPairing> | null>(null);
  const [states, setStates] = useState<ReadonlyMap<string, RouteState>>(new Map());
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let stops: Array<() => void> = [];
    let closed = false;

    const update = (token: string, state: Partial<RouteState>) => {
      if (closed) return;
      setStates((current) => {
        const before = current.get(token) ?? { view: null, info: null };

        return new Map(current).set(token, { ...before, ...state });
      });
    };

    void readPairings(LocalStorage).then((stored) => {
      if (closed) return;
      setPairings(stored);
      setStates(new Map());
      stops = stored.map((p) => followPairing(p, update));
    });

    return () => {
      closed = true;

      for (const stop of stops) stop();
    };
  }, [generation]);

  return { pairings, states, reload };
};

const routeName = (stored: StoredPairing) => {
  const { url } = stored.pairing;

  return url === null ? "This Mac, over the Daemon's socket" : (URL.parse(url)?.host ?? url);
};

const PairingItem = (props: {
  readonly stored: StoredPairing;
  readonly state: RouteState | undefined;
  readonly reload: () => void;
}) => {
  const { stored, state } = props;
  const view = state?.view ?? null;
  const connection = view === null ? null : connectionState(view);

  const failure =
    view?.error == null ? null : describeFailure(view.error, "connect", view.hostName);

  const remove = async () => {
    const confirmed = await confirmAlert({
      title: `Remove the pairing with ${stored.pairing.hostName}?`,
      message:
        "Raycast forgets it. The host keeps the pairing until you revoke it in Polaris, under Settings → Extensions.",
      primaryAction: { title: "Remove Pairing", style: Alert.ActionStyle.Destructive },
    });

    if (!confirmed) return;
    await removePairing(LocalStorage, stored.pairing.token);
    props.reload();
  };

  return (
    <List.Item
      title={routeName(stored)}
      subtitle={failure === null ? `Paired as ${stored.pairing.name}` : failure.title}
      icon={connection === null ? Icon.Circle : ICON[connection]}
      accessories={[
        ...(state?.info == null
          ? []
          : [{ text: `Polaris ${state.info.daemonVersion}`, tooltip: state.info.hostname }]),
        connection === null
          ? { text: "Connecting…" }
          : { tag: CONNECTION_LABEL[connection], tooltip: failure?.message ?? null },
      ]}
      actions={
        <ActionPanel>
          <Action.Push
            title="Add Pairing"
            icon={Icon.Plus}
            shortcut={Keyboard.Shortcut.Common.New}
            target={<AddPairingForm onAdded={props.reload} />}
          />
          <Action
            title="Check Again"
            icon={Icon.ArrowClockwise}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={props.reload}
          />
          <Action
            title="Remove Pairing"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={Keyboard.Shortcut.Common.Remove}
            onAction={() => void remove()}
          />
        </ActionPanel>
      }
    />
  );
};

const byHost = (pairings: ReadonlyArray<StoredPairing>) => {
  const hosts = new Map<string, Array<StoredPairing>>();

  for (const stored of pairings)
    hosts.set(stored.pairing.hostId, [...(hosts.get(stored.pairing.hostId) ?? []), stored]);

  return [...hosts.values()];
};

export default function Hosts() {
  const { pairings, states, reload } = usePairings();

  return (
    <List isLoading={pairings === null} searchBarPlaceholder="Search hosts">
      <List.EmptyView
        title="No pairings yet"
        description="In Polaris, open Settings → Extensions, pair Raycast, then add its pairing string here."
        actions={
          <ActionPanel>
            <Action.Push
              title="Add Pairing"
              icon={Icon.Plus}
              target={<AddPairingForm onAdded={reload} />}
            />
          </ActionPanel>
        }
      />
      {byHost(pairings ?? []).map((group) => {
        const first = group[0]?.pairing;

        return first === undefined ? null : (
          <List.Section key={first.hostId} title={first.hostName}>
            {group.map((stored) => (
              <PairingItem
                key={stored.pairing.token}
                stored={stored}
                state={states.get(stored.pairing.token)}
                reload={reload}
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}

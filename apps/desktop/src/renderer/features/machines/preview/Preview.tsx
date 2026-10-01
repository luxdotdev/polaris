/**
 * Settings → Hosts on fixtures, for screenshots and the smoke: `#hosts/all`,
 * `#hosts/current`, `#hosts/failures` and `#hosts/live`, where Update walks a
 * fake host through checking, copying and switching. Nothing is installed.
 */
import { Option, Schema } from "effect";
import { createRoot } from "react-dom/client";
import { createStore } from "zustand/vanilla";
import type { MachineView, PolarisApi, Result } from "../../../../shared/api.ts";
import type { DaemonUpdateView } from "../../../../shared/daemonUpdates.ts";
import { App } from "../../../app/App.tsx";
import { createCommandRegistry } from "../../../routes/commands.ts";
import { createNavigation } from "../../../routes/navigation.ts";
import { type AppState, type Connection, initialState } from "../../../store/store.ts";
import { standInBridge } from "../../bridge.ts";
import { machinesFor, type Scene, SCENES } from "./fixtures.ts";

const OK: Result<null> = { ok: true, value: null };

const UNSUPPORTED = { ok: false, error: { code: "Unsupported", message: "preview" } } as const;

const TOTAL = 18_600_000;

/** The fake machines feed: a list, and a way to change one Host's update facts. */
const createFeed = (initial: ReadonlyArray<MachineView>) => {
  let machines = initial;
  const listeners = new Set<(list: ReadonlyArray<MachineView>) => void>();

  const publish = () => {
    for (const listener of listeners) listener(machines);
  };

  const patch = (keys: ReadonlyArray<string> | null, change: Partial<DaemonUpdateView>) => {
    machines = machines.map((m) =>
      m.daemon !== null && (keys === null || keys.includes(m.key))
        ? { ...m, daemon: { ...m.daemon, ...change } }
        : m
    );
    publish();
  };

  const listen = (listener: (list: ReadonlyArray<MachineView>) => void) => {
    listeners.add(listener);
    queueMicrotask(() => listener(machines));

    return () => listeners.delete(listener);
  };

  return { listen, patch, get: () => machines };
};

type Feed = ReturnType<typeof createFeed>;

/** Checking, then copying in real-looking chunks, then switching, then done. */
const simulateUpdate = (feed: Feed, hostKey: string) => {
  const target = feed.get().find((m) => m.key === hostKey)?.daemon;

  if (target === null || target === undefined) return;
  const from = target.installedVersion;
  const version = target.bundledVersion;

  const steps: Array<[number, Partial<DaemonUpdateView>]> = [
    [0, { progress: { stage: "checking", bytes: 0, total: 0 }, lastUpdate: null }],
    ...Array.from({ length: 11 }, (_, i): [number, Partial<DaemonUpdateView>] => [
      700 + i * 220,
      { progress: { stage: "uploading", bytes: Math.round((TOTAL * i) / 10), total: TOTAL } },
    ]),
    [3300, { progress: { stage: "switching", bytes: 0, total: 0 } }],
    [
      4600,
      {
        progress: null,
        installedVersion: version,
        updateAvailable: false,
        lastUpdate: { at: Date.now() + 4600, result: "updated", from, version, problem: null },
      },
    ],
  ];

  for (const [at, change] of steps) setTimeout(() => feed.patch([hostKey], change), at);
};

const Input = Schema.Struct({
  hostKey: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

/** The three update requests change the feed; the rest answer "unsupported" (a toast). */
const answer = (
  feed: Feed,
  method: string,
  { hostKey, enabled }: typeof Input.Type
): Result<null> | null => {
  switch (method) {
    case "machines.updateDaemon":
      if (hostKey !== undefined) simulateUpdate(feed, hostKey);

      return OK;
    case "machines.setKeepDaemonsUpToDate":
      feed.patch(null, { keepDaemonsUpToDate: enabled === true });
      // The effective choice follows for hosts without their own.
      feed.patch(
        feed
          .get()
          .filter((m) => m.daemon?.keepUpToDateOverride === null)
          .map((m) => m.key),
        { keepUpToDate: enabled === true }
      );

      return OK;
    case "machines.setDaemonUpdateOverride": {
      const all = feed.get().find((m) => m.key === hostKey)?.daemon?.keepDaemonsUpToDate ?? true;

      if (hostKey !== undefined)
        feed.patch([hostKey], {
          keepUpToDateOverride: enabled ?? null,
          keepUpToDate: enabled ?? all,
        });

      return OK;
    }

    case "clipboard.write":
      return OK;
    default:
      return null;
  }
};

const bridgeFor = (feed: Feed): PolarisApi => ({
  request: (method, input) => {
    const fields = Option.getOrElse(Schema.decodeUnknownOption(Input)(input), () => ({}));

    // SAFETY: every request this preview answers has a null output.
    return Promise.resolve((answer(feed, method, fields) ?? UNSUPPORTED) as never);
  },
  subscribe: (kind, _input, listener) => {
    if (kind !== "machines") return () => undefined;

    // SAFETY: only the machines feed is answered; its items are machine lists.
    return feed.listen((list) => listener.items([list as never]));
  },
  onAppEvent: () => () => undefined,
});

const sceneOf = (hash: string): Scene => {
  const name = hash.replace(/^#hosts\//, "");

  return SCENES.find((s) => s === name) ?? "all";
};

export const mountHostsPreview = (root: HTMLElement, hash: string) => {
  const feed = createFeed(machinesFor(sceneOf(hash), Date.now()));
  const store = createStore<AppState>(() => initialState);

  const connection: Connection = {
    store,
    openSession: () => () => undefined,
    setDensity: (density) => store.setState({ density }),
    setAppearance: ({ density, theme }) => store.setState({ density, theme }),
  };

  const navigation = createNavigation({ app: store, storage: null });

  standInBridge(bridgeFor(feed));
  navigation.actions.openSettings("hosts");

  const commands = createCommandRegistry({ mac: true });

  createRoot(root).render(<App value={{ connection, navigation, commands }} />);

  return connection.setDensity;
};

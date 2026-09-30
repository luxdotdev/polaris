/**
 * The Client runtime in the main process: one Effect runtime holding
 * `@polaris/client`'s HostRegistry, the local Host plus the remote Hosts from
 * the settings, and the Host list (with Connection States) the renderers see.
 */
import { hostname } from "node:os";
import {
  type ClientIdentity,
  type ConnectionStatus,
  type HostConnection,
  HostConnector,
  HostRegistry,
  HostTarget,
} from "@polaris/client";
import { Capability } from "@polaris/protocol";
import {
  Context,
  Effect,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { ConnectionStatusView, HostView, IpcError } from "../shared/api.ts";
import type { LocalDaemon } from "./localDaemon.ts";
import type { RemoteHostSetting } from "./settings.ts";

export const LOCAL_HOST_KEY = "local";

export class UnknownHost extends Error {
  readonly _tag = "UnknownHost";

  constructor(readonly key: string) {
    super(`no Host "${key}"`);
  }
}

/** A Host as the settings describe it, before it connects. */
export interface HostEntry {
  readonly key: string;
  readonly label: string;
  readonly colour: string | null;
  readonly alias: string | null;
  readonly proofHarness: boolean;
  readonly target: HostTarget;
}

export const statusView = (status: ConnectionStatus): ConnectionStatusView => ({
  state: status.state,
  failure:
    status.failure === null
      ? null
      : {
          kind: status.failure.kind,
          reason: status.failure.reason,
          detail: status.failure.detail,
        },
  attempt: status.attempt,
  since: status.since,
  nextAttemptAt: status.nextAttemptAt,
  host: status.host,
  capabilities: status.capabilities,
  epoch: status.epoch,
});

export const hostView = (entry: HostEntry, status: ConnectionStatus): HostView => ({
  key: entry.key,
  label: entry.label,
  colour: entry.colour,
  alias: entry.alias,
  proofHarness: entry.proofHarness,
  status: statusView(status),
});

/** A Host on a local socket under its own name: screenshots and tests only (`POLARIS_DESKTOP_EXTRA_HOSTS`). */
export const ExtraHost = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1)),
  label: Schema.String,
  socket: Schema.String,
});

export type ExtraHost = typeof ExtraHost.Type;

const decodeExtras = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(ExtraHost)));

export const extraHosts = (json: string | undefined): ReadonlyArray<ExtraHost> =>
  json === undefined || json === "" ? [] : Option.getOrElse(decodeExtras(json), () => []);

export interface HostEntriesInput {
  readonly local: LocalDaemon;
  readonly remotes: ReadonlyArray<RemoteHostSetting>;
  readonly extras?: ReadonlyArray<ExtraHost>;
  /** The local Host's name; "This Mac" by default. */
  readonly localLabel?: string;
}

/** The local Host first, then the remote Hosts in settings order; duplicate aliases dropped. */
export const hostEntries = ({
  local,
  remotes,
  extras = [],
  localLabel = "This Mac",
}: HostEntriesInput): ReadonlyArray<HostEntry> => {
  const seen = new Set<string>([LOCAL_HOST_KEY]);

  const entries: Array<HostEntry> = [
    {
      key: LOCAL_HOST_KEY,
      label: localLabel,
      colour: null,
      alias: null,
      proofHarness: local.benchHarness,
      target: HostTarget.Local({ socketPath: local.socketPath }),
    },
  ];

  for (const extra of extras) {
    if (seen.has(extra.key)) continue;
    seen.add(extra.key);
    entries.push({
      key: extra.key,
      label: extra.label,
      colour: null,
      alias: null,
      proofHarness: false,
      target: HostTarget.Local({ socketPath: extra.socket }),
    });
  }

  for (const remote of remotes) {
    if (seen.has(remote.alias)) continue;
    seen.add(remote.alias);
    entries.push({
      key: remote.alias,
      label: remote.label ?? remote.alias,
      colour: remote.colour ?? null,
      alias: remote.alias,
      proofHarness: false,
      target: HostTarget.Ssh({ alias: remote.alias, forwardAgent: remote.forwardAgent ?? false }),
    });
  }

  return entries;
};

export const clientIdentity = (version: string): ClientIdentity => ({
  name: "Polaris",
  version,
  deviceLabel: hostname().replace(/\.local$/, ""),
  capabilities: Capability.literals,
});

const replaceView = (views: ReadonlyArray<HostView>, view: HostView) => {
  const at = views.findIndex((v) => v.key === view.key);

  if (at === -1) return [...views, view];

  return views.map((v, i) => (i === at ? view : v));
};

export interface HostDirectoryInput {
  readonly entries: ReadonlyArray<HostEntry>;
  readonly identity: ClientIdentity;
}

/** The Hosts this app connects to, and their views for the renderers. */
export class HostDirectory extends Context.Service<
  HostDirectory,
  {
    /** The Host list, updated on every Connection State change. */
    readonly views: SubscriptionRef.SubscriptionRef<ReadonlyArray<HostView>>;
    readonly entry: (key: string) => HostEntry | undefined;
    readonly connection: (key: string) => Effect.Effect<HostConnection, UnknownHost>;
  }
>()("polaris/desktop/HostDirectory") {
  static readonly layer = ({ entries, identity }: HostDirectoryInput) =>
    Layer.effect(
      HostDirectory,
      Effect.gen(function* () {
        const registry = yield* HostRegistry;
        const views = yield* SubscriptionRef.make<ReadonlyArray<HostView>>([]);
        const byKey = new Map(entries.map((e) => [e.key, e]));

        for (const entry of entries) {
          const connection = yield* registry.add({
            key: entry.key,
            name: entry.label,
            target: entry.target,
            identity,
          });

          yield* connection.changes.pipe(
            Stream.runForEach((status) =>
              SubscriptionRef.update(views, (current) =>
                replaceView(current, hostView(entry, status))
              )
            ),
            Effect.forkScoped
          );
        }

        const connection = (key: string) =>
          Effect.flatMap(
            registry.get(key),
            Option.match({
              onNone: () => Effect.fail(new UnknownHost(key)),
              onSome: (found) => Effect.succeed(found),
            })
          );

        return HostDirectory.of({ views, entry: (key) => byKey.get(key), connection });
      })
    ).pipe(Layer.provide(HostRegistry.layer), Layer.provide(HostConnector.layer));
}

export type ClientRuntime = ManagedRuntime.ManagedRuntime<HostDirectory, never>;

/** Starts connecting to every Host; the runtime owns every connection until disposed. */
export const startClientRuntime = (input: HostDirectoryInput): ClientRuntime =>
  ManagedRuntime.make(HostDirectory.layer(input));

/** Every failure crossing IPC becomes its tag and message. */
export const toIpcError = (error: {
  readonly _tag: string;
  readonly message: string;
}): IpcError => ({
  code: error._tag,
  message: error.message,
});

/** Waits until the Host with `key` is first Connected. */
export const whenConnected = (key: string) =>
  HostDirectory.use((dir) =>
    SubscriptionRef.changes(dir.views).pipe(
      Stream.filter((views) => views.some((v) => v.key === key && v.status.state === "connected")),
      Stream.runHead,
      Effect.asVoid
    )
  );

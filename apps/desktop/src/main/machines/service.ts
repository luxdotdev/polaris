/**
 * `Machines`: the Hosts in Settings. Adds and removes remote Hosts by
 * `~/.ssh/config` alias, runs each one's install flow (probe, one-time
 * approval, install or upgrade), switches the local Host, and publishes the
 * Settings rows. A background check (a reconnect) never installs.
 */
import type { InstallTrigger, Ssh } from "@polaris/client/install";
import type { HarnessKind } from "@polaris/protocol";
import { Context, Effect, Fiber, Layer, Schema, Stream, SubscriptionRef } from "effect";
import type { HarnessAvailabilityView, MachineView, SshAliasView } from "../../shared/api.ts";
import { HostDirectory, LOCAL_HOST_KEY, localEntry, remoteEntry } from "../hosts.ts";
import type { LocalDaemon } from "../localDaemon.ts";
import type { RemoteHostSetting, Settings } from "../settings.ts";
import type { Approvals } from "./approvals.ts";
import type { DaemonBuilds } from "./builds.ts";
import { type InstallEvent, initialInstall, stepInstall } from "./installFlow.ts";
import { applyWork, failureMessage, planFor, startDaemon } from "./remote.ts";
import { onHostArgv, sshArgv } from "./terminal.ts";
import { backgroundCheckKey, type InstallRecord, machineViews } from "./views.ts";

export class MachineError extends Schema.TaggedError<MachineError>()("MachineError", {
  message: Schema.String,
}) {}

export interface SettingsStore {
  readonly get: () => Settings;
  readonly update: (change: (settings: Settings) => Settings) => void;
}

export interface MachinesInput {
  readonly settings: SettingsStore;
  readonly approvals: Approvals;
  readonly builds: DaemonBuilds;
  readonly aliases: () => ReadonlyArray<SshAliasView>;
  /** Finds or starts the local Daemon when the local Host is switched on. */
  readonly localDaemon: () => Promise<LocalDaemon>;
  /** Opens Terminal on this Mac running `argv`. */
  readonly openTerminal: (argv: ReadonlyArray<string>) => Promise<void>;
  /** How install commands reach a Host (`Ssh.layer`; tests replace it). */
  readonly ssh: Layer.Layer<Ssh>;
}

export interface AddMachine {
  readonly alias: string;
  readonly label: string;
  readonly colour: string | null;
  readonly forwardAgent: boolean;
}

export interface MachinePatch {
  readonly label?: string;
  readonly colour?: string | null;
  readonly forwardAgent?: boolean;
  readonly remoteCommand?: string | null;
}

type Failure = { readonly message: string };

const fail = (message: string) => Effect.fail(new MachineError({ message }));

const asMachineError = (error: Failure) => new MachineError({ message: failureMessage(error) });

type MutableSetting = { -readonly [K in keyof RemoteHostSetting]: RemoteHostSetting[K] };

/** Applies a patch; a null colour or an empty remote command removes the setting. */
const patched = (remote: RemoteHostSetting, patch: MachinePatch): RemoteHostSetting => {
  const { remoteCommand, colour, ...rest } = { ...remote, ...patch };
  const next: MutableSetting = rest;
  const line = remoteCommand?.trim() ?? "";

  if (colour !== null && colour !== undefined) next.colour = colour;

  if (line !== "") next.remoteCommand = line;

  return next;
};

export class Machines extends Context.Service<
  Machines,
  {
    readonly views: SubscriptionRef.SubscriptionRef<ReadonlyArray<MachineView>>;
    readonly sshAliases: Effect.Effect<ReadonlyArray<SshAliasView>>;
    readonly add: (input: AddMachine) => Effect.Effect<string, MachineError>;
    readonly update: (key: string, patch: MachinePatch) => Effect.Effect<void, MachineError>;
    readonly remove: (key: string) => Effect.Effect<void, MachineError>;
    /** The user asked: probe and plan, and install an approved build. */
    readonly check: (key: string) => Effect.Effect<void, MachineError>;
    readonly approve: (key: string, sha256: string) => Effect.Effect<void, MachineError>;
    readonly dismiss: (key: string) => Effect.Effect<void, MachineError>;
    readonly startDaemon: (key: string) => Effect.Effect<void, MachineError>;
    readonly setLocalEnabled: (enabled: boolean) => Effect.Effect<void, MachineError>;
    readonly harnesses: (
      key: string,
      refresh: boolean
    ) => Effect.Effect<ReadonlyArray<HarnessAvailabilityView> | null, MachineError>;
    readonly openSsh: (key: string) => Effect.Effect<void, MachineError>;
    readonly signIn: (key: string, harness: HarnessKind) => Effect.Effect<void, MachineError>;
  }
>()("polaris/desktop/Machines") {
  static readonly layer = (input: MachinesInput) => Layer.effect(Machines, makeMachines(input));
}

const makeMachines = Effect.fnUntraced(function* (input: MachinesInput) {
  const dir = yield* HostDirectory;
  const scope = yield* Effect.scope;
  const installs = new Map<string, InstallRecord>();
  const work = new Map<string, Fiber.Fiber<void>>();
  const views = yield* SubscriptionRef.make<ReadonlyArray<MachineView>>([]);
  let aliases = input.aliases();

  const publish = Effect.flatMap(SubscriptionRef.get(dir.views), (hosts) =>
    SubscriptionRef.set(
      views,
      machineViews({ settings: input.settings.get(), hosts, installs, aliases })
    )
  );

  const remoteSetting = (key: string) =>
    (input.settings.get().hosts ?? []).find((h) => h.alias === key);

  const requireRemote = (key: string) => {
    const remote = remoteSetting(key);

    return remote === undefined ? fail(`no remote host "${key}"`) : Effect.succeed(remote);
  };

  const record = (key: string): InstallRecord =>
    installs.get(key) ?? { snapshot: initialInstall(), activity: null, offerSize: null };

  const step = (key: string, event: InstallEvent, activity: string | null = null) =>
    Effect.suspend(() => {
      const previous = record(key);
      const snapshot = stepInstall(previous.snapshot, event);
      installs.set(key, { ...previous, snapshot, activity });

      return Effect.as(publish, snapshot);
    });

  const setRecord = (key: string, patch: Partial<InstallRecord>) =>
    Effect.suspend(() => {
      installs.set(key, { ...record(key), ...patch });

      return publish;
    });

  const retryConnection = (key: string) =>
    dir.connection(key).pipe(
      Effect.flatMap((connection) => connection.retryNow),
      Effect.ignore
    );

  /** Runs `effect` as the Host's one piece of background work, replacing any before it. */
  const launch = (key: string, effect: Effect.Effect<void>) =>
    Effect.gen(function* () {
      const previous = work.get(key);

      if (previous !== undefined) yield* Fiber.interrupt(previous);
      work.set(key, yield* Effect.forkIn(effect, scope));
    });

  /** The flow after `check` moved to checking: plan, then maybe install. */
  const checkBody = (alias: string, trigger: InstallTrigger) =>
    Effect.gen(function* () {
      const { plan, size } = yield* planFor({
        alias,
        trigger,
        approved: input.approvals.approved(alias),
        builds: input.builds,
        onBuild: setRecord(alias, { activity: "Building the daemon for this host from source" }),
      });

      yield* setRecord(alias, { offerSize: size });

      const planned = yield* step(
        alias,
        { type: "planned", plan },
        "Copying the build over SSH and checking its SHA-256"
      );

      const pending = planned.value === "installing" ? planned.context.work : null;

      if (pending === null) return;
      const outcome = yield* applyWork(alias, pending);
      yield* step(alias, { type: "applied", outcome });
      yield* retryConnection(alias);
    }).pipe(
      Effect.provide(input.ssh),
      Effect.catch((error) =>
        step(alias, {
          type: "failed",
          problem: { kind: "failed", message: failureMessage(error), command: null },
        })
      ),
      Effect.asVoid
    );

  const runCheck = (alias: string, trigger: InstallTrigger) =>
    Effect.gen(function* () {
      const started = yield* step(alias, { type: "check", trigger }, `Checking ${alias}`);

      if (started.value === "checking") yield* launch(alias, checkBody(alias, trigger));
    });

  const bundledVersion = () =>
    input.builds.forPlatform(null, { build: false, onBuild: Effect.void }).pipe(
      Effect.map((builds) => builds[0]?.version ?? null),
      Effect.orElseSucceed(() => null)
    );

  // Background checks: once per occasion a Host's Connection State calls for one.
  const occasions = new Map<string, string>();
  yield* SubscriptionRef.changes(dir.views).pipe(
    Stream.runForEach((hosts) =>
      Effect.gen(function* () {
        yield* publish;
        const bundled = yield* bundledVersion();

        for (const host of hosts) {
          const occasion = backgroundCheckKey(host, bundled);

          if (occasion === null || host.alias === null || occasions.get(host.key) === occasion)
            continue;
          occasions.set(host.key, occasion);
          yield* runCheck(host.alias, "background");
        }
      })
    ),
    Effect.forkIn(scope)
  );

  const add = (machine: AddMachine) =>
    Effect.gen(function* () {
      if (remoteSetting(machine.alias) !== undefined) {
        return yield* fail(`${machine.alias} is already a host`);
      }

      const setting: RemoteHostSetting = patched(
        { alias: machine.alias, forwardAgent: machine.forwardAgent },
        { label: machine.label.trim() || machine.alias, colour: machine.colour }
      );

      input.settings.update((s) => ({ ...s, hosts: [...(s.hosts ?? []), setting] }));
      // The user's check starts before the connection can ask for a background one.
      yield* runCheck(machine.alias, "user");
      yield* dir.add(remoteEntry(setting));
      yield* publish;

      return machine.alias;
    });

  const update = (key: string, patch: MachinePatch) =>
    Effect.gen(function* () {
      const next = patched(yield* requireRemote(key), patch);
      input.settings.update((s) => ({
        ...s,
        hosts: (s.hosts ?? []).map((h) => (h.alias === key ? next : h)),
      }));
      yield* dir.add(remoteEntry(next));
      yield* publish;
    });

  const remove = (key: string) =>
    Effect.gen(function* () {
      yield* requireRemote(key);
      input.settings.update((s) => ({
        ...s,
        hosts: (s.hosts ?? []).filter((h) => h.alias !== key),
      }));
      input.approvals.forget(key);
      const running = work.get(key);
      work.delete(key);

      if (running !== undefined) yield* Fiber.interrupt(running);
      installs.delete(key);
      occasions.delete(key);
      yield* dir.remove(key);
      yield* publish;
    });

  const approve = (key: string, sha256: string) =>
    Effect.gen(function* () {
      const offer = record(key).snapshot.context.offer;

      if (offer === null || offer.sha256 !== sha256) {
        return yield* fail("that build is no longer the one offered; check again");
      }

      input.approvals.approve(key, { ...offer, approvedAt: Date.now() });
      const approved = yield* step(key, { type: "approve" }, `Checking ${key}`);

      if (approved.value === "checking") yield* launch(key, checkBody(key, "user"));
    });

  const restart = (key: string) =>
    Effect.gen(function* () {
      yield* requireRemote(key);
      yield* startDaemon(key).pipe(Effect.provide(input.ssh), Effect.mapError(asMachineError));
      yield* retryConnection(key);
    });

  const setLocalEnabled = (enabled: boolean) =>
    Effect.gen(function* () {
      input.settings.update((s) => ({ ...s, local: { enabled } }));

      if (!enabled) {
        yield* dir.remove(LOCAL_HOST_KEY);
      } else if (dir.entry(LOCAL_HOST_KEY) === undefined) {
        const local = yield* Effect.tryPromise({
          try: input.localDaemon,
          catch: (cause) =>
            new MachineError({ message: `the local daemon didn't start: ${String(cause)}` }),
        });

        yield* dir.add(localEntry(local));
      }

      yield* publish;
    });

  const live = (key: string) =>
    dir.connection(key).pipe(
      Effect.flatMap((connection) => connection.session),
      Effect.mapError(asMachineError)
    );

  const availability = (key: string, refresh: boolean) =>
    Effect.gen(function* () {
      const session = yield* live(key);

      if (!session.capabilities.includes("harness.availability")) return null;

      const report = yield* session.client["harness.availability"]({ refresh }).pipe(
        Effect.mapError(asMachineError)
      );

      return report.harnesses;
    });

  const harnesses = (key: string, refresh: boolean) =>
    Effect.map(availability(key, refresh), (found) =>
      found === null
        ? null
        : found.map((h): HarnessAvailabilityView => ({
            harness: h.harness,
            status: h.status,
            version: h.version,
            minVersion: h.minVersion,
            detail: h.detail,
            canSignIn: h.signInArgv !== null,
          }))
    );

  const terminal = (argv: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () => input.openTerminal(argv),
      catch: (cause) => new MachineError({ message: `Terminal didn't open: ${String(cause)}` }),
    });

  const signIn = (key: string, harness: HarnessKind) =>
    Effect.gen(function* () {
      const found = (yield* availability(key, false))?.find((h) => h.harness === harness);

      if (found?.signInArgv == null) return yield* fail(`${harness} can't sign in on ${key}`);
      yield* terminal(onHostArgv(dir.entry(key)?.alias ?? null, found.signInArgv));
    });

  yield* publish;

  return Machines.of({
    views,
    sshAliases: Effect.sync(() => {
      aliases = input.aliases();

      return aliases;
    }).pipe(Effect.tap(() => publish)),
    add,
    update,
    remove,
    check: (key) => Effect.andThen(requireRemote(key), runCheck(key, "user")),
    approve,
    dismiss: (key) => Effect.asVoid(step(key, { type: "dismiss" })),
    startDaemon: restart,
    setLocalEnabled,
    harnesses,
    openSsh: (key) => Effect.andThen(requireRemote(key), terminal(sshArgv(key))),
    signIn,
  });
});

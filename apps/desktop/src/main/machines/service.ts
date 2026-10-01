/**
 * `Machines`: the Hosts in Settings. Adds and removes remote Hosts by
 * `~/.ssh/config` alias, runs each one's install flow (probe, one-time
 * approval, install or upgrade), switches the local Host, and publishes the
 * Settings rows. A background check (a reconnect) never installs.
 */
import { InstallPlan, type InstallTrigger, Ssh } from "@polaris/client/install";
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Predicate,
  Queue,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";
import type { MachineView, SshAliasView } from "../../shared/api.ts";
import { HostDirectory, LOCAL_HOST_KEY, localEntry, remoteEntry } from "../hosts.ts";
import type { LocalDaemon } from "../localDaemon.ts";
import type { RemoteHostSetting, Settings } from "../settings.ts";
import type { Approvals } from "./approvals.ts";
import type { DaemonBuilds } from "./builds.ts";
import { type InstallEvent, initialInstall, stepInstall } from "./installFlow.ts";
import { applyWork, failureMessage, planFor, startDaemon } from "./remote.ts";
import { sshArgv } from "./terminal.ts";
import { backgroundCheckKey, type InstallRecord, localUpgradeKey, machineViews } from "./views.ts";
import { type UpdateFacts, updatePolicy } from "./updateFacts.ts";
import type { DaemonUpdateProgress, DaemonUpdateResult } from "../../shared/daemonUpdates.ts";

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
  /**
   * The home whose installed Daemon (`~/.polaris`) serves the local Host, so
   * it upgrades like a remote one; null when this app runs its own or was given a socket.
   */
  readonly localHome: () => string | null;
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

/** What a check is doing while it runs, under the card's "Checking <host>". */
const PROBING = "Asking over SSH for the platform and any installed daemon.";

const PROBING_LOCAL = "Checking the daemon installed on this Mac.";

/** The local Host only ever upgrades: installing a Daemon here is the user's own step. */
const NO_LOCAL_INSTALL =
  "This Mac has no daemon Polaris installed, so there is nothing to upgrade.";

const installsAnew = (plan: InstallPlan) =>
  Predicate.isTagged(plan, "NeedsApproval") || Predicate.isTagged(plan, "Install");

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
    readonly updateDaemon: (key: string) => Effect.Effect<void, MachineError>;
    readonly setKeepDaemonsUpToDate: (enabled: boolean) => Effect.Effect<void>;
    readonly setDaemonUpdateOverride: (
      key: string,
      enabled: boolean | null
    ) => Effect.Effect<void, MachineError>;
    readonly approve: (key: string, sha256: string) => Effect.Effect<void, MachineError>;
    readonly dismiss: (key: string) => Effect.Effect<void, MachineError>;
    readonly startDaemon: (key: string) => Effect.Effect<void, MachineError>;
    readonly setLocalEnabled: (enabled: boolean) => Effect.Effect<void, MachineError>;
    readonly openSsh: (key: string) => Effect.Effect<void, MachineError>;
  }
>()("polaris/desktop/Machines") {
  static readonly layer = (input: MachinesInput) => Layer.effect(Machines, makeMachines(input));
}

const makeMachines = Effect.fnUntraced(function* (input: MachinesInput) {
  const dir = yield* HostDirectory;
  const scope = yield* Effect.scope;
  const installs = new Map<string, InstallRecord>();
  const work = new Map<string, Fiber.Fiber<void>>();
  const updates = new Map<string, UpdateFacts>();
  const progressChanges = yield* Queue.unbounded<void>();
  const views = yield* SubscriptionRef.make<ReadonlyArray<MachineView>>([]);
  let aliases = input.aliases();

  let bundledBuilds = yield* input.builds
    .forPlatform(null, { build: false, onBuild: Effect.void })
    .pipe(Effect.orElseSucceed(() => []));

  let bundled = bundledBuilds[0]?.version ?? null;

  const publish = Effect.flatMap(SubscriptionRef.get(dir.views), (hosts) =>
    SubscriptionRef.set(
      views,
      machineViews({
        settings: input.settings.get(),
        hosts,
        installs,
        aliases,
        updates,
        bundledVersion: bundled,
        bundledVersions: new Map(bundledBuilds.map((b) => [b.platform, b.version])),
        localManaged: input.localHome() !== null,
      })
    )
  );

  const remoteSetting = (key: string) =>
    (input.settings.get().hosts ?? []).find((h) => h.alias === key);

  const requireRemote = (key: string) => {
    const remote = remoteSetting(key);

    return remote === undefined ? fail(`no remote host "${key}"`) : Effect.succeed(remote);
  };

  /** How a check reaches the Host: ssh to a remote alias, or a local shell for this Mac. */
  const target = (key: string) => {
    const home = key === LOCAL_HOST_KEY ? input.localHome() : null;

    return home === null
      ? { alias: key, ssh: input.ssh, local: false, probing: PROBING }
      : { alias: "local", ssh: Ssh.local(home), local: true, probing: PROBING_LOCAL };
  };

  const requireCheckable = (key: string) =>
    key !== LOCAL_HOST_KEY
      ? requireRemote(key)
      : input.localHome() === null
        ? fail("this Mac's daemon is the app's own, not one Polaris installed")
        : Effect.void;

  const record = (key: string): InstallRecord =>
    installs.get(key) ?? { snapshot: initialInstall(), activity: null, offerSize: null };

  const step = (key: string, event: InstallEvent, activity: string | null = null) =>
    Effect.suspend(() => {
      const previous = record(key);
      const snapshot = stepInstall(previous.snapshot, event);

      if (snapshot === previous.snapshot) return Effect.succeed(snapshot);
      installs.set(key, { ...previous, snapshot, activity });

      return Effect.as(publish, snapshot);
    });

  const setRecord = (key: string, patch: Partial<InstallRecord>) =>
    Effect.suspend(() => {
      installs.set(key, { ...record(key), ...patch });

      return publish;
    });

  const updateFacts = (key: string, patch: Partial<UpdateFacts>) =>
    Effect.gen(function* () {
      const hosts = yield* SubscriptionRef.get(dir.views);
      const host = hosts.find((h) => h.key === key);
      const previous = updates.get(key);
      updates.set(key, {
        platform: host?.status.host?.platform ?? null,
        installedVersion: host?.status.host?.daemonVersion ?? null,
        bundledVersion: bundled,
        epoch: host?.status.epoch ?? 0,
        progress: null,
        lastUpdate: input.settings.get().daemonUpdates?.[key] ?? null,
        ...previous,
        ...patch,
      });
      yield* publish;
    });

  const finishUpdate = (key: string, result: DaemonUpdateResult) =>
    Effect.gen(function* () {
      input.settings.update((s) => ({
        ...s,
        daemonUpdates: { ...s.daemonUpdates, [key]: result },
      }));
      const progress = updates.get(key)?.progress;
      yield* updateFacts(key, {
        lastUpdate: result,
        installedVersion:
          result.problem === null ? result.version : (updates.get(key)?.installedVersion ?? null),
        progress: {
          stage: result.problem === null ? "done" : "failed",
          bytes: progress?.bytes ?? 0,
          total: progress?.total ?? 0,
        },
      });
    });

  const progress = (key: string) => (value: DaemonUpdateProgress) => {
    const previous = updates.get(key);

    if (previous === undefined) return;
    updates.set(key, { ...previous, progress: value });
    Queue.offerUnsafe(progressChanges, undefined);
  };

  yield* Stream.fromQueue(progressChanges).pipe(
    Stream.runForEach(() => publish),
    Effect.forkIn(scope)
  );

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

  const finishCheck = (
    key: string,
    snapshot: import("./installFlow.ts").InstallSnapshot,
    installedVersion: string | null,
    bundledVersion: string | null,
    skipped: boolean
  ) =>
    Effect.gen(function* () {
      const problem = snapshot.context.problem;

      if (problem !== null) {
        yield* finishUpdate(key, {
          at: Date.now(),
          result: "failed",
          from: installedVersion,
          version: bundledVersion,
          problem: { ...problem, sshFailure: null },
        });
      } else if (snapshot.context.outcome !== null && !skipped) {
        yield* finishUpdate(key, {
          at: Date.now(),
          result: snapshot.context.outcome.kind === "newer" ? "newer" : "current",
          from: installedVersion,
          version: installedVersion,
          problem: null,
        });
      } else {
        yield* updateFacts(key, { progress: null });
      }
    });

  /** The flow after `check` moved to checking: plan, then maybe install. */
  const checkBody = (key: string, trigger: InstallTrigger, updateOnly = false) => {
    const to = target(key);

    return Effect.gen(function* () {
      const {
        platform,
        plan: proposed,
        size,
        installedVersion,
        bundledVersion,
      } = yield* planFor({
        alias: to.alias,
        trigger,
        approved: to.local ? new Set<string>() : input.approvals.approved(key),
        builds: input.builds,
        onBuild: setRecord(key, { activity: "Building the daemon for this host from source" }),
      });

      bundledBuilds = yield* input.builds
        .forPlatform(null, { build: false, onBuild: Effect.void })
        .pipe(Effect.orElseSucceed(() => []));
      bundled = bundledBuilds[0]?.version ?? null;
      const hosts = yield* SubscriptionRef.get(dir.views);
      yield* updateFacts(key, {
        platform,
        installedVersion,
        bundledVersion,
        epoch: hosts.find((h) => h.key === key)?.status.epoch ?? 0,
      });

      const plan =
        trigger === "background" &&
        !updatePolicy(input.settings.get(), key).keepUpToDate &&
        Predicate.isTagged(proposed, "Upgrade")
          ? InstallPlan.UpToDate({ version: proposed.from })
          : proposed;

      if ((to.local || updateOnly) && installsAnew(plan)) {
        yield* step(key, {
          type: "failed",
          problem: {
            kind: "failed",
            message: to.local
              ? NO_LOCAL_INSTALL
              : "No daemon is installed. Use Install daemon first.",
            command: null,
          },
        });
        yield* finishUpdate(key, {
          at: Date.now(),
          result: "failed",
          from: installedVersion,
          version: bundledVersion,
          problem: {
            kind: "failed",
            message: to.local
              ? NO_LOCAL_INSTALL
              : "No daemon is installed. Use Install daemon first.",
            command: null,
            sshFailure: null,
          },
        });

        return;
      }

      yield* setRecord(key, { offerSize: size });

      const planned = yield* step(
        key,
        { type: "planned", plan },
        to.local
          ? "Copying the build and checking its SHA-256"
          : "Copying the build over SSH and checking its SHA-256"
      );

      const pending = planned.value === "installing" ? planned.context.work : null;

      if (pending === null) {
        yield* finishCheck(key, planned, installedVersion, bundledVersion, proposed !== plan);

        return;
      }

      const outcome = yield* applyWork(to.alias, pending, progress(key));
      yield* step(key, { type: "applied", outcome });
      yield* finishUpdate(key, {
        at: Date.now(),
        result: "updated",
        from: outcome.from,
        version: outcome.version,
        problem: null,
      });
      yield* retryConnection(key);
    }).pipe(
      Effect.provide(to.ssh),
      Effect.catchTag("SshError", (error) =>
        step(key, {
          type: "failed",
          problem: { kind: "ssh", message: failureMessage(error), command: null },
        }).pipe(
          Effect.andThen(
            finishUpdate(key, {
              at: Date.now(),
              result: "failed",
              from: updates.get(key)?.installedVersion ?? null,
              version: updates.get(key)?.bundledVersion ?? bundled,
              problem: {
                kind: "ssh",
                message: failureMessage(error),
                command: null,
                sshFailure: error.failure,
              },
            })
          )
        )
      ),
      Effect.catch((error) =>
        step(key, {
          type: "failed",
          problem: { kind: "failed", message: failureMessage(error), command: null },
        }).pipe(
          Effect.andThen(
            finishUpdate(key, {
              at: Date.now(),
              result: "failed",
              from: updates.get(key)?.installedVersion ?? null,
              version: bundled,
              problem: {
                kind: "failed",
                message: failureMessage(error),
                command: null,
                sshFailure: null,
              },
            })
          )
        )
      ),
      Effect.asVoid
    );
  };

  const runCheck = (key: string, trigger: InstallTrigger, updateOnly = false) =>
    Effect.gen(function* () {
      const previous = record(key).snapshot;
      const started = yield* step(key, { type: "check", trigger }, target(key).probing);

      if (started !== previous && started.value === "checking") {
        yield* updateFacts(key, { progress: { stage: "checking", bytes: 0, total: 0 } });
        yield* launch(key, checkBody(key, trigger, updateOnly));
      }
    });

  // Background checks: once per occasion a Host's Connection State calls for one.
  const occasions = new Map<string, string>();
  let buildsOccasion = "";

  const background = (hosts: ReadonlyArray<import("../../shared/api.ts").HostView>) =>
    Effect.gen(function* () {
      const nextOccasion = hosts
        .map((h) => `${h.key}:${h.status.state}:${h.status.epoch}:${h.status.since}`)
        .join("|");

      if (buildsOccasion !== nextOccasion) {
        buildsOccasion = nextOccasion;
        bundledBuilds = yield* input.builds
          .forPlatform(null, { build: false, onBuild: Effect.void })
          .pipe(Effect.orElseSucceed(() => []));
        bundled = bundledBuilds[0]?.version ?? null;
      }

      yield* publish;

      for (const host of hosts) {
        const policy = updatePolicy(input.settings.get(), host.key);
        const missing = host.status.failure?.reason === "polaris-not-installed";

        if (!policy.keepUpToDate && !missing) continue;

        const occasion =
          host.key === LOCAL_HOST_KEY
            ? localUpgradeKey(host, bundled, input.localHome())
            : backgroundCheckKey(host, bundled);

        if (occasion === null) continue;
        const key = `${occasion}:${bundled}`;

        if (occasions.get(host.key) === key) continue;
        occasions.set(host.key, key);
        yield* runCheck(host.alias ?? host.key, "background");
      }
    });

  yield* SubscriptionRef.changes(dir.views).pipe(
    Stream.runForEach(background),
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
        daemonUpdates: Object.fromEntries(
          Object.entries(s.daemonUpdates ?? {}).filter(([alias]) => alias !== key)
        ),
      }));
      input.approvals.forget(key);
      const running = work.get(key);
      work.delete(key);

      if (running !== undefined) yield* Fiber.interrupt(running);
      installs.delete(key);
      updates.delete(key);
      occasions.delete(key);
      buildsOccasion = "";
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
      const approved = yield* step(key, { type: "approve" }, PROBING);

      if (approved.value === "checking") {
        yield* updateFacts(key, { progress: { stage: "checking", bytes: 0, total: 0 } });
        yield* launch(key, checkBody(key, "user"));
      }
    });

  const restart = (key: string) =>
    Effect.gen(function* () {
      yield* requireRemote(key);
      yield* startDaemon(key).pipe(Effect.provide(input.ssh), Effect.mapError(asMachineError));
      yield* retryConnection(key);
    });

  const setLocalEnabled = (enabled: boolean) =>
    Effect.gen(function* () {
      input.settings.update((s) => ({ ...s, local: { ...s.local, enabled } }));

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

      occasions.delete(LOCAL_HOST_KEY);
      yield* Effect.flatMap(SubscriptionRef.get(dir.views), background);
      yield* publish;
    });

  const terminal = (argv: ReadonlyArray<string>) =>
    Effect.tryPromise({
      try: () => input.openTerminal(argv),
      catch: (cause) => new MachineError({ message: `Terminal didn't open: ${String(cause)}` }),
    });

  yield* publish;

  const setDaemonUpdateOverride = (key: string, enabled: boolean | null) =>
    Effect.gen(function* () {
      if (key !== LOCAL_HOST_KEY) yield* requireRemote(key);
      input.settings.update((s) => {
        const override = <T extends { readonly keepDaemonUpToDate?: boolean }>(host: T) => {
          const { keepDaemonUpToDate: _previous, ...rest } = host;

          return enabled === null ? rest : { ...rest, keepDaemonUpToDate: enabled };
        };

        return key === LOCAL_HOST_KEY
          ? { ...s, local: override(s.local ?? { enabled: true }) }
          : { ...s, hosts: (s.hosts ?? []).map((h) => (h.alias === key ? override(h) : h)) };
      });
      occasions.delete(key);
      buildsOccasion = "";
      yield* Effect.flatMap(SubscriptionRef.get(dir.views), background);
      yield* publish;
    });

  return Machines.of({
    views,
    sshAliases: Effect.sync(() => {
      aliases = input.aliases();

      return aliases;
    }).pipe(Effect.tap(() => publish)),
    add,
    update,
    remove,
    check: (key) => Effect.andThen(requireCheckable(key), runCheck(key, "user")),
    updateDaemon: (key) => Effect.andThen(requireCheckable(key), runCheck(key, "user", true)),
    setKeepDaemonsUpToDate: (enabled) =>
      Effect.sync(() =>
        input.settings.update((s) => ({ ...s, keepDaemonsUpToDate: enabled }))
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            occasions.clear();
            buildsOccasion = "";
          })
        ),
        Effect.andThen(Effect.flatMap(SubscriptionRef.get(dir.views), background)),
        Effect.andThen(publish)
      ),
    setDaemonUpdateOverride,
    approve,
    dismiss: (key) => Effect.asVoid(step(key, { type: "dismiss" })),
    startDaemon: restart,
    setLocalEnabled,
    openSsh: (key) => Effect.andThen(requireRemote(key), terminal(sshArgv(key))),
  });
});

/**
 * The macOS service step of `polaris install`: load, reload or restart the
 * LaunchAgent in the launchd domain it is actually loaded in, and put the
 * previous definition back when the new one won't load (README, "launchd").
 */
import { Duration, Effect } from "effect";
import { type CommandResult, CommandRunner } from "./CommandRunner.ts";
import { InstallError } from "./errors.ts";

/** `gui/<uid>` while someone is logged in at the console; `user/<uid>` always. */
export type LaunchdDomain = "gui" | "user";

export interface LaunchdState {
  /** Where the label is loaded now, if anywhere. */
  readonly loadedIn: LaunchdDomain | null;
  /** `gui/<uid>` exists. */
  readonly guiDomain: boolean;
  readonly changed: { readonly binary: boolean; readonly serviceFile: boolean };
}

/**
 * - `kickstart`: same definition; start it, restarting (`-k`) on a new binary.
 * - `reload`: a new definition; boot it out, wait until launchd has let it go, bootstrap it again.
 * - `load`: nothing loaded; bootstrap.
 */
export type LaunchdPlan =
  | { readonly action: "kickstart"; readonly domain: LaunchdDomain; readonly restart: boolean }
  | { readonly action: "reload"; readonly domain: LaunchdDomain }
  | { readonly action: "load"; readonly domain: LaunchdDomain };

/** Pure: what to do with the LaunchAgent. A loaded service stays in its domain. */
export const planLaunchd = (state: LaunchdState): LaunchdPlan => {
  if (state.loadedIn === null) return { action: "load", domain: state.guiDomain ? "gui" : "user" };

  if (state.changed.serviceFile) return { action: "reload", domain: state.loadedIn };

  return { action: "kickstart", domain: state.loadedIn, restart: state.changed.binary };
};

/**
 * What a failed `launchctl bootstrap` means. `busy` (5, EIO) is launchd's
 * answer while the label is still loaded, including a booted-out job that
 * hasn't exited yet; `no-domain` is a domain this session can't use.
 */
export type BootstrapOutcome = "loaded" | "busy" | "no-domain" | "failed";

const NO_DOMAIN_CODES: ReadonlySet<number> = new Set([112, 113, 125]);

export const classifyBootstrap = (result: CommandResult): BootstrapOutcome => {
  if (result.code === 0) return "loaded";

  if (result.code === 5) return "busy";

  if (NO_DOMAIN_CODES.has(result.code) || /could not find domain/i.test(result.stderr))
    return "no-domain";

  return "failed";
};

export interface LaunchdTarget {
  readonly uid: number;
  readonly label: string;
  readonly serviceFile: string;
}

export interface LaunchdTiming {
  /** How long a booted-out Daemon may take to exit (launchd's own ExitTimeOut is 20 s). */
  readonly unloadTimeoutMs: number;
  readonly pollMs: number;
}

export const defaultLaunchdTiming: LaunchdTiming = { unloadTimeoutMs: 30_000, pollMs: 100 };

export interface LaunchdActivation {
  readonly domain: string;
  readonly restarted: boolean;
  readonly notes: ReadonlyArray<string>;
}

const run = Effect.fnUntraced(function* (argv: ReadonlyArray<string>) {
  const runner = yield* CommandRunner;

  return yield* runner.run(argv);
});

const output = (result: CommandResult) => (result.stderr || result.stdout).trim();

const domainId = (target: LaunchdTarget, domain: LaunchdDomain) => `${domain}/${target.uid}`;

const serviceId = (target: LaunchdTarget, domain: LaunchdDomain) =>
  `${domainId(target, domain)}/${target.label}`;

const isLoaded = (target: LaunchdTarget, domain: LaunchdDomain) =>
  run(["launchctl", "print", serviceId(target, domain)]).pipe(Effect.map((r) => r.code === 0));

/** Where the label is loaded now, and (when nowhere) whether the GUI domain exists. */
export const probeLaunchd = Effect.fnUntraced(function* (target: LaunchdTarget) {
  if (yield* isLoaded(target, "gui")) return { loadedIn: "gui" as const, guiDomain: true };

  if (yield* isLoaded(target, "user")) return { loadedIn: "user" as const, guiDomain: false };
  const gui = yield* run(["launchctl", "print", domainId(target, "gui")]);

  return { loadedIn: null, guiDomain: gui.code === 0 };
});

/** Waits until launchd no longer has the label in `domain`; false on timeout. */
const waitUnloaded = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain,
  timing: LaunchdTiming
) {
  const polls = Math.max(1, Math.ceil(timing.unloadTimeoutMs / Math.max(1, timing.pollMs)));

  for (let poll = 0; poll < polls; poll++) {
    if (!(yield* isLoaded(target, domain))) return true;
    yield* Effect.sleep(Duration.millis(timing.pollMs));
  }

  return !(yield* isLoaded(target, domain));
});

const loadError = (target: LaunchdTarget, domain: LaunchdDomain, result: CommandResult) =>
  new InstallError({
    step: "load service",
    message: `launchctl bootstrap ${domainId(target, domain)} exited ${result.code}: ${output(result)}`,
  });

/** Bootstrap into `domain`, waiting out a job that is still exiting. */
const bootstrapInto = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain,
  timing: LaunchdTiming
) {
  let result = yield* run(["launchctl", "bootstrap", domainId(target, domain), target.serviceFile]);

  for (let retry = 0; retry < 3 && classifyBootstrap(result) === "busy"; retry++) {
    yield* waitUnloaded(target, domain, timing);
    result = yield* run(["launchctl", "bootstrap", domainId(target, domain), target.serviceFile]);
  }

  return result;
});

/** Start the loaded service; `restart` kills a running one first, a fresh load also enables it. */
const start = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain,
  how: { readonly restart: boolean; readonly enable: boolean }
) {
  if (how.enable) yield* run(["launchctl", "enable", serviceId(target, domain)]);

  const kick = yield* run([
    "launchctl",
    "kickstart",
    ...(how.restart ? ["-k"] : []),
    serviceId(target, domain),
  ]);

  if (kick.code !== 0) {
    return yield* new InstallError({
      step: "start service",
      message: `launchctl kickstart ${serviceId(target, domain)} exited ${kick.code}: ${output(kick)}`,
    });
  }
});

/** Boot the label out of `domain` and wait for its job to exit. */
const unload = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain,
  timing: LaunchdTiming
) {
  yield* run(["launchctl", "bootout", serviceId(target, domain)]);

  if (!(yield* waitUnloaded(target, domain, timing))) {
    return yield* new InstallError({
      step: "load service",
      message: `${serviceId(target, domain)} was still loaded ${timing.unloadTimeoutMs} ms after launchctl bootout`,
    });
  }
});

/** Boot the label out of both domains and wait for its job to exit (uninstall). */
export const unloadEverywhere = Effect.fnUntraced(function* (
  target: Omit<LaunchdTarget, "serviceFile">,
  timing: LaunchdTiming = defaultLaunchdTiming
) {
  const full = { ...target, serviceFile: "" };

  for (const domain of ["gui", "user"] as const) {
    if (yield* isLoaded(full, domain)) yield* unload(full, domain, timing);
  }
});

const load = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain,
  timing: LaunchdTiming,
  notes: Array<string>
) {
  const result = yield* bootstrapInto(target, domain, timing);
  const outcome = classifyBootstrap(result);

  if (outcome === "loaded") return domain;

  // gui/<uid> exists but this session (SSH) may not use it: user/<uid> runs without one.
  const guiUnusable =
    domain === "gui" &&
    (outcome === "no-domain" || (outcome === "busy" && !(yield* isLoaded(target, "gui"))));

  if (!guiUnusable) return yield* loadError(target, domain, result);
  notes.push(
    `Could not load into ${domainId(target, "gui")} (${output(result)}); using ${domainId(target, "user")}.`
  );
  const user = yield* bootstrapInto(target, "user", timing);

  if (classifyBootstrap(user) !== "loaded") return yield* loadError(target, "user", user);

  return "user" as const;
});

const apply = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  plan: LaunchdPlan,
  timing: LaunchdTiming,
  notes: Array<string>
) {
  if (plan.action === "kickstart") {
    yield* start(target, plan.domain, { restart: plan.restart, enable: false });

    return { domain: plan.domain, restarted: plan.restart };
  }

  if (plan.action === "reload") {
    yield* unload(target, plan.domain, timing);
    const bootstrapped = yield* bootstrapInto(target, plan.domain, timing);

    if (classifyBootstrap(bootstrapped) !== "loaded")
      return yield* loadError(target, plan.domain, bootstrapped);
    yield* start(target, plan.domain, { restart: false, enable: true });

    return { domain: plan.domain, restarted: true };
  }

  if (plan.domain === "user") {
    notes.push(
      `No GUI login session (${domainId(target, "gui")} does not exist); using ${domainId(target, "user")}.`
    );
  }

  const domain = yield* load(target, plan.domain, timing, notes);
  yield* start(target, domain, { restart: false, enable: true });

  return { domain, restarted: false };
});

/**
 * Put the previous binary and definition back (`restoreFiles`) and leave the
 * service as it was: loaded and running in `domain`, or not loaded at all.
 */
const rollBack = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  domain: LaunchdDomain | null,
  restoreFiles: Effect.Effect<boolean, InstallError>,
  timing: LaunchdTiming
) {
  const restored = yield* restoreFiles;

  if (domain === null) return "the previous files are back; the Daemon was not loaded before";

  yield* unloadEverywhere(target, timing);
  const result = yield* bootstrapInto(target, domain, timing);

  if (classifyBootstrap(result) !== "loaded") return yield* loadError(target, domain, result);
  yield* start(target, domain, { restart: false, enable: true });

  return restored
    ? `rolled back: the previous Daemon runs again in ${domainId(target, domain)}`
    : `the previous Daemon runs again in ${domainId(target, domain)}`;
});

/**
 * Load (or reload, or restart) the LaunchAgent. On failure it rolls back
 * through `restoreFiles`, which puts the previous `current` link and service
 * file back, and fails with what went wrong and how the rollback went.
 */
export const activateLaunchd = Effect.fnUntraced(function* (
  target: LaunchdTarget,
  changed: LaunchdState["changed"],
  restoreFiles: Effect.Effect<boolean, InstallError>,
  timing: LaunchdTiming = defaultLaunchdTiming
) {
  const notes: Array<string> = [];
  const probed = yield* probeLaunchd(target);
  const plan = planLaunchd({ ...probed, changed });

  const applied = yield* apply(target, plan, timing, notes).pipe(
    Effect.catchTag("InstallError", (error) =>
      rollBack(target, probed.loadedIn, restoreFiles, timing).pipe(
        Effect.match({
          onFailure: (rollback) =>
            new InstallError({
              step: error.step,
              message: `${error.message}; rollback failed too: ${rollback.message}`,
            }),
          onSuccess: (rollback) =>
            new InstallError({ step: error.step, message: `${error.message}; ${rollback}` }),
        }),
        Effect.flatMap((failure) => Effect.fail(failure))
      )
    )
  );

  return { domain: domainId(target, applied.domain), restarted: applied.restarted, notes };
});

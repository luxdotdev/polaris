/**
 * `polaris install` / `polaris uninstall`: lay the binary out under
 * `~/.polaris/bin/<version>/polaris`, point `~/.polaris/bin/current` at it,
 * and register a user service (launchd LaunchAgent on macOS, systemd
 * `--user` unit on Linux). No sudo, ever. Every step is idempotent: running
 * install twice with the same binary changes nothing and restarts nothing.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";
import { Effect, Schema } from "effect";
import { defaultStateFile, stopAppServer } from "../harness/codex/AppServer.ts";
import { CommandRunner } from "./CommandRunner.ts";
import {
  LAUNCHD_LABEL,
  launchdPlist,
  type ServiceSpec,
  SUPERVISOR_MARKER,
  SYSTEMD_UNIT,
  supervisorScript,
  supervisorStartLine,
  systemdUnit,
} from "./templates.ts";

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  step: Schema.String,
  message: Schema.String,
}) {}

export type ServiceOs = "darwin" | "linux";

export interface InstallContext {
  readonly os: ServiceOs;
  /** `~/.polaris` (or `POLARIS_HOME`). */
  readonly polarisHome: string;
  /** The user's home directory, where `Library/LaunchAgents` or `.config/systemd` live. */
  readonly userHome: string;
  /** `$XDG_CONFIG_HOME`, when set (Linux). */
  readonly xdgConfigHome: string | null;
  readonly uid: number;
  readonly user: string;
  /** PATH for the service, so the Daemon finds Harnesses and git. */
  readonly path: string;
}

export const defaultInstallContext = (polarisHome: string): InstallContext => {
  const info = userInfo();

  return {
    os: process.platform === "darwin" ? "darwin" : "linux",
    polarisHome,
    userHome: homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    uid: info.uid,
    user: info.username,
    path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
};

export const layout = (ctx: InstallContext, version?: string) => {
  const bin = join(ctx.polarisHome, "bin");

  return {
    bin,
    current: join(bin, "current"),
    launcher: join(bin, "current", "polaris"),
    versionDir: version === undefined ? null : join(bin, version),
    installed: version === undefined ? null : join(bin, version, "polaris"),
    logs: join(ctx.polarisHome, "logs"),
    /** The fallback supervisor on Linux Hosts without systemd --user. */
    supervisor: join(bin, "polaris-supervise"),
    serviceFile:
      ctx.os === "darwin"
        ? join(ctx.userHome, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
        : join(ctx.xdgConfigHome ?? join(ctx.userHome, ".config"), "systemd", "user", SYSTEMD_UNIT),
  };
};

export const serviceSpec = (ctx: InstallContext): ServiceSpec => {
  const paths = layout(ctx);

  return {
    program: paths.launcher,
    args: ["serve"],
    home: ctx.polarisHome,
    logDir: paths.logs,
    env: { PATH: ctx.path },
  };
};

export const renderServiceFile = (ctx: InstallContext): string =>
  ctx.os === "darwin" ? launchdPlist(serviceSpec(ctx)) : systemdUnit(serviceSpec(ctx));

export const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export type LingerStatus = "enabled" | "already-enabled" | "needs-admin" | "not-applicable";

/** What keeps the Daemon running: launchd, systemd --user, or Polaris' own fallback supervisor. */
export type Supervisor = "launchd" | "systemd" | "fallback";

/** How the fallback supervisor comes back after a reboot or logout. */
export type Autostart = "cron" | "profile";

export type CrontabAccess = "available" | "missing" | "denied";

export interface LinuxServiceProbe {
  /** `systemctl --user` reaches a user manager (a user bus exists). */
  readonly userSystemd: boolean;
  readonly crontab: CrontabAccess;
}

/**
 * Pure: which supervisor a Linux Host gets. systemd --user whenever it
 * answers; otherwise the fallback supervisor, started at boot by cron
 * `@reboot` when the user may edit their crontab, and at login by the shell
 * profile always (it is single-instance, so both are harmless together).
 */
export const planLinuxService = (
  probe: LinuxServiceProbe
): { readonly supervisor: "systemd" | "fallback"; readonly autostart: ReadonlyArray<Autostart> } =>
  probe.userSystemd
    ? { supervisor: "systemd", autostart: [] }
    : {
        supervisor: "fallback",
        autostart: probe.crontab === "available" ? ["cron", "profile"] : ["profile"],
      };

export interface InstallReport {
  readonly version: string;
  readonly binary: string;
  readonly sha256: string;
  readonly binaryChanged: boolean;
  readonly serviceFile: string;
  readonly serviceFileChanged: boolean;
  /** The launchd domain (`gui/501`, `user/501`) or `systemd --user`. */
  readonly serviceDomain: string;
  readonly restarted: boolean;
  readonly linger: LingerStatus;
  /** What keeps the Daemon running; the Client shows `fallback` with `notes`. */
  readonly supervisor: Supervisor;
  /** Fallback only: what starts it again after a reboot (cron) or at login (profile). */
  readonly autostart: ReadonlyArray<Autostart>;
  readonly notes: ReadonlyArray<string>;
}

const fsStep = <A>(step: string, f: () => A) =>
  Effect.try({ try: f, catch: (error) => new InstallError({ step, message: String(error) }) });

/** Copies `source` into place atomically; false if an identical file is already there. */
const placeFile = (source: string, target: string, sha256: string, mode: number) =>
  fsStep(`copy ${basename(target)}`, () => {
    if (source === target) return false;

    if (existsSync(target) && sha256File(target) === sha256) return false;
    mkdirSync(dirname(target), { recursive: true });
    const temp = `${target}.tmp-${process.pid}`;
    copyFileSync(source, temp);
    chmodSync(temp, mode);
    renameSync(temp, target);

    return true;
  });

/**
 * Copies `source` to `~/.polaris/bin/<version>/polaris` (a no-op if an
 * identical file is there). The binary is self-contained: native libraries
 * such as fff's are embedded by `bun build --compile`.
 */
export const stageBinary = Effect.fn("stageBinary")(function* (
  ctx: InstallContext,
  options: InstallOptions
) {
  const path = layout(ctx, options.version).installed!;
  const sha256 = yield* fsStep("hash binary", () => sha256File(options.source));
  const changed = yield* placeFile(options.source, path, sha256, 0o755);

  return { path, sha256, changed };
});

/** Points `current` at `version` with an atomic rename; false if it already did. */
export const pointCurrentAt = (ctx: InstallContext, version: string) =>
  fsStep("link current", () => {
    const { current } = layout(ctx);

    try {
      if (readlinkSync(current) === version) return false;
    } catch {}

    const temp = `${current}.tmp-${process.pid}`;
    rmSync(temp, { force: true });
    symlinkSync(version, temp);
    renameSync(temp, current);

    return true;
  });

const writeIfChanged = (path: string, content: string, mode = 0o644) =>
  fsStep("write service file", () => {
    if (existsSync(path) && readFileSync(path, "utf8") === content) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, { mode });
    chmodSync(path, mode);

    return true;
  });

const run = Effect.fnUntraced(function* (
  argv: ReadonlyArray<string>,
  options?: { readonly stdin?: string }
) {
  const runner = yield* CommandRunner;

  return yield* runner.run(argv, options);
});

const runOrFail = Effect.fnUntraced(function* (step: string, argv: ReadonlyArray<string>) {
  const result = yield* run(argv);

  if (result.code !== 0) {
    return yield* new InstallError({
      step,
      message: `\`${argv.join(" ")}\` exited ${result.code}: ${(result.stderr || result.stdout).trim()}`,
    });
  }

  return result;
});

/**
 * Load (or reload) the LaunchAgent. `gui/<uid>` exists only while the user
 * is logged in at the console; over SSH to a Mac with nobody logged in we
 * fall back to the `user/<uid>` domain, which runs without a GUI session.
 */
const activateLaunchd = Effect.fnUntraced(function* (
  ctx: InstallContext,
  serviceFile: string,
  changed: { readonly binary: boolean; readonly serviceFile: boolean }
) {
  const notes: Array<string> = [];
  let domain = `gui/${ctx.uid}`;

  const loaded = (d: string) =>
    run(["launchctl", "print", `${d}/${LAUNCHD_LABEL}`]).pipe(Effect.map((r) => r.code === 0));

  let isLoaded = yield* loaded(domain);

  if (!isLoaded && (yield* loaded(`user/${ctx.uid}`))) {
    domain = `user/${ctx.uid}`;
    isLoaded = true;
  }

  if (isLoaded && !changed.serviceFile) {
    // Same definition: start it if stopped, restart only if the binary changed.
    const kick = changed.binary ? ["-k"] : [];
    yield* runOrFail("start service", [
      "launchctl",
      "kickstart",
      ...kick,
      `${domain}/${LAUNCHD_LABEL}`,
    ]);

    return { domain, restarted: changed.binary, linger: "not-applicable" as const, notes };
  }

  if (isLoaded) yield* run(["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`]);
  let boot = yield* run(["launchctl", "bootstrap", domain, serviceFile]);

  if (boot.code !== 0 && domain.startsWith("gui/")) {
    notes.push(
      `No GUI login session (launchctl bootstrap ${domain}: ${boot.stderr.trim()}); using user/${ctx.uid}.`
    );
    domain = `user/${ctx.uid}`;
    boot = yield* run(["launchctl", "bootstrap", domain, serviceFile]);
  }

  if (boot.code !== 0) {
    return yield* new InstallError({
      step: "load service",
      message: `launchctl bootstrap ${domain} exited ${boot.code}: ${boot.stderr.trim()}`,
    });
  }

  yield* run(["launchctl", "enable", `${domain}/${LAUNCHD_LABEL}`]);
  yield* runOrFail("start service", ["launchctl", "kickstart", `${domain}/${LAUNCHD_LABEL}`]);

  return { domain, restarted: isLoaded, linger: "not-applicable" as const, notes };
});

// ── Linux without systemd --user ───────────────────────────────────────────

/** Probe the Host's service options; never fails. */
export const probeLinuxService = Effect.fnUntraced(function* () {
  const systemd = yield* run(["systemctl", "--user", "show-environment"]);
  const crontab = yield* run(["crontab", "-l"]);

  const access: CrontabAccess =
    crontab.code === 0 || /no crontab/i.test(crontab.stderr)
      ? "available"
      : crontab.code === 127
        ? "missing"
        : "denied";

  return {
    probe: { userSystemd: systemd.code === 0, crontab: access } satisfies LinuxServiceProbe,
    systemdError:
      systemd.code === 127
        ? "systemctl is not installed"
        : (systemd.stderr || systemd.stdout).trim(),
    crontab: crontab.code === 0 ? crontab.stdout : "",
  };
});

/** `lines` without Polaris' marked lines, plus `line` (when given), newline-terminated. */
const withMarkedLine = (content: string, line: string | null): string => {
  const kept = content.split("\n").filter((l) => l !== "" && !l.includes(SUPERVISOR_MARKER));
  const all = line === null ? kept : [...kept, line];

  return all.length === 0 ? "" : `${all.join("\n")}\n`;
};

/** The login profiles to hook: `~/.profile`, plus bash's own if they exist (bash reads only the first). */
const profileFiles = (ctx: InstallContext): Array<string> => [
  join(ctx.userHome, ".profile"),
  ...[".bash_profile", ".bash_login"].flatMap((name) => {
    const path = join(ctx.userHome, name);

    return existsSync(path) ? [path] : [];
  }),
];

const editProfiles = (ctx: InstallContext, line: string | null) =>
  fsStep("edit login profile", () => {
    for (const file of profileFiles(ctx)) {
      const before = existsSync(file) ? readFileSync(file, "utf8") : null;

      if (before === null && line === null) continue;

      const kept = (before ?? "")
        .split("\n")
        .filter((l) => !l.includes(SUPERVISOR_MARKER))
        .join("\n")
        .replace(/\n*$/, "");

      const after = line === null ? `${kept}\n` : `${kept}${kept === "" ? "" : "\n"}${line}\n`;

      if (after !== before) writeFileSync(file, after);
    }
  });

const pidFromFile = (path: string): number | null => {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());

    if (!Number.isInteger(pid) || pid <= 0) return null;
    process.kill(pid, 0);

    return pid;
  } catch {
    return null;
  }
};

/** SIGTERM `pid` and wait up to 5 s for it to go. */
const terminate = (pid: number) =>
  Effect.promise(async () => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }

    const deadline = Date.now() + 5_000;

    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }

      await Bun.sleep(50);
    }
  });

const activateFallback = Effect.fnUntraced(function* (
  ctx: InstallContext,
  changed: { readonly binary: boolean; readonly serviceFile: boolean },
  plan: { readonly autostart: ReadonlyArray<Autostart> },
  found: { readonly systemdError: string; readonly crontab: string }
) {
  const paths = layout(ctx);

  const notes: Array<string> = [
    `No systemd user bus on this Host (${found.systemdError || "systemctl --user failed"}), so Polaris runs under its own supervisor (${paths.supervisor}). It restarts the Daemon if it exits.`,
  ];

  if (plan.autostart.includes("cron")) {
    const next = withMarkedLine(found.crontab, supervisorStartLine(paths.supervisor, "cron"));

    if (next !== found.crontab) {
      const written = yield* run(["crontab", "-"], { stdin: next });

      if (written.code !== 0) {
        return yield* new InstallError({
          step: "edit crontab",
          message: `crontab - exited ${written.code}: ${written.stderr.trim()}`,
        });
      }
    }

    notes.push("It starts at boot through cron @reboot, if a cron daemon runs at boot.");
  } else {
    notes.push(
      "It does not start at boot (no usable crontab); it starts at your next login, or when the Client reinstalls."
    );
  }

  yield* editProfiles(ctx, supervisorStartLine(paths.supervisor, "profile"));
  // A new binary: stop the running Daemon; the supervisor restarts it on `current`.
  const daemon = pidFromFile(join(ctx.polarisHome, "daemon.pid"));
  const restart = daemon !== null && (changed.binary || changed.serviceFile);

  if (restart) yield* terminate(daemon);
  yield* runOrFail("start supervisor", [paths.supervisor]);

  return {
    domain: "polaris-supervisor",
    restarted: restart,
    linger: "not-applicable" as const,
    notes,
  };
});

/** Stop the fallback supervisor (and its Daemon) and remove its autostart lines. */
const removeFallback = Effect.fnUntraced(function* (ctx: InstallContext) {
  const supervisor = pidFromFile(join(ctx.polarisHome, "supervisor.pid"));

  if (supervisor !== null) yield* terminate(supervisor);
  const crontab = yield* run(["crontab", "-l"]);

  if (crontab.code === 0 && crontab.stdout.includes(SUPERVISOR_MARKER)) {
    yield* run(["crontab", "-"], { stdin: withMarkedLine(crontab.stdout, null) });
  }

  yield* editProfiles(ctx, null);

  return supervisor !== null;
});

/**
 * Enable lingering so the user manager (and the Daemon) survives logout and
 * starts at boot. Allowed for oneself on most distributions when the session
 * is local; over SSH polkit often wants an administrator.
 */
const enableLinger = Effect.fnUntraced(function* (ctx: InstallContext) {
  const shown = yield* run(["loginctl", "show-user", ctx.user, "--property=Linger", "--value"]);

  if (shown.code === 0 && shown.stdout.trim() === "yes") return "already-enabled" as const;
  const enabled = yield* run(["loginctl", "enable-linger", ctx.user]);

  return enabled.code === 0 ? ("enabled" as const) : ("needs-admin" as const);
});

const activateSystemd = Effect.fnUntraced(function* (
  ctx: InstallContext,
  changed: { readonly binary: boolean; readonly serviceFile: boolean }
) {
  const notes: Array<string> = [];
  const systemctl = (...args: Array<string>) => ["systemctl", "--user", ...args];

  if (changed.serviceFile) yield* runOrFail("reload units", systemctl("daemon-reload"));
  const active = yield* run(systemctl("is-active", "--quiet", SYSTEMD_UNIT));
  yield* runOrFail("enable service", systemctl("enable", SYSTEMD_UNIT));
  const restart = active.code === 0 && (changed.binary || changed.serviceFile);
  yield* runOrFail("start service", systemctl(restart ? "restart" : "start", SYSTEMD_UNIT));
  const linger = yield* enableLinger(ctx);

  if (linger === "needs-admin") {
    notes.push(
      `Lingering is off, so the Daemon stops when ${ctx.user} logs out. An administrator can run: sudo loginctl enable-linger ${ctx.user}`
    );
  }

  return { domain: "systemd --user", restarted: restart, linger, notes };
});

export interface InstallOptions {
  /** The compiled `polaris` binary to install (normally this process's own executable). */
  readonly source: string;
  readonly version: string;
}

export const install = Effect.fn("install")(function* (
  ctx: InstallContext,
  options: InstallOptions
): Effect.fn.Return<InstallReport, InstallError, CommandRunner> {
  const paths = layout(ctx, options.version);
  yield* fsStep("create directories", () =>
    mkdirSync(paths.logs, { recursive: true, mode: 0o700 })
  );
  const staged = yield* stageBinary(ctx, options);
  const sha256 = staged.sha256;
  const binaryChanged = staged.changed;
  const currentChanged = yield* pointCurrentAt(ctx, options.version);
  const linux = ctx.os === "linux" ? yield* probeLinuxService() : null;
  const plan = linux === null ? null : planLinuxService(linux.probe);
  const fallback = plan?.supervisor === "fallback";
  const serviceFile = fallback ? paths.supervisor : paths.serviceFile;

  const serviceFileChanged = fallback
    ? yield* writeIfChanged(serviceFile, supervisorScript(serviceSpec(ctx)), 0o755)
    : yield* writeIfChanged(serviceFile, renderServiceFile(ctx));

  const changed = { binary: binaryChanged || currentChanged, serviceFile: serviceFileChanged };

  const activation =
    ctx.os === "darwin"
      ? yield* activateLaunchd(ctx, paths.serviceFile, changed)
      : fallback
        ? yield* activateFallback(ctx, changed, plan, linux!)
        : yield* activateSystemd(ctx, changed);

  const supervisor: Supervisor =
    ctx.os === "darwin" ? "launchd" : fallback ? "fallback" : "systemd";

  return {
    version: options.version,
    binary: staged.path,
    sha256,
    binaryChanged: changed.binary,
    serviceFile,
    serviceFileChanged,
    serviceDomain: activation.domain,
    restarted: activation.restarted,
    linger: activation.linger,
    supervisor,
    autostart: fallback ? plan.autostart : [],
    notes: activation.notes,
  };
});

export interface UninstallReport {
  readonly serviceFileRemoved: boolean;
  /** PID of the shared Codex app-server that was stopped, if one was running. */
  readonly codexAppServerStopped: number | null;
  /** Linux: the fallback supervisor (and its Daemon) was running and was stopped. */
  readonly supervisorStopped: boolean;
  readonly binariesRemoved: boolean;
  readonly purged: boolean;
}

/**
 * Stop and remove the user service and installed binaries. State (the event
 * store, logs, staging) stays unless `purge`, so a reinstall picks up where
 * it left off.
 */
export const uninstall = Effect.fn("uninstall")(function* (
  ctx: InstallContext,
  options: { readonly purge: boolean }
): Effect.fn.Return<UninstallReport, InstallError, CommandRunner> {
  const paths = layout(ctx);
  let supervisorStopped = false;

  if (ctx.os === "darwin") {
    yield* run(["launchctl", "bootout", `gui/${ctx.uid}/${LAUNCHD_LABEL}`]);
    yield* run(["launchctl", "bootout", `user/${ctx.uid}/${LAUNCHD_LABEL}`]);
  } else {
    yield* run(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
    supervisorStopped = yield* removeFallback(ctx);
  }

  // The shared Codex app-server outlives the Daemon on purpose; uninstall ends it.
  const appServer = yield* stopAppServer({
    stateFile: defaultStateFile(join(ctx.polarisHome, "codex.sock")),
    socketPath: join(ctx.polarisHome, "codex.sock"),
  });

  const serviceFileRemoved = yield* fsStep("remove service file", () => {
    const existed = existsSync(paths.serviceFile);
    rmSync(paths.serviceFile, { force: true });

    return existed;
  });

  if (ctx.os === "linux" && serviceFileRemoved) {
    yield* run(["systemctl", "--user", "daemon-reload"]);
  }

  const binariesRemoved = yield* fsStep("remove binaries", () => {
    const existed = existsSync(paths.bin);
    rmSync(options.purge ? ctx.polarisHome : paths.bin, { recursive: true, force: true });

    return existed;
  });

  return {
    serviceFileRemoved,
    codexAppServerStopped: appServer.stopped,
    supervisorStopped,
    binariesRemoved,
    purged: options.purge,
  };
});

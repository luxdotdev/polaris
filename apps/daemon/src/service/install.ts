/**
 * `polaris install` / `polaris uninstall`: lay the binary out under
 * `~/.polaris/bin/<version>/polaris`, point `~/.polaris/bin/current` at it,
 * and register a user service (launchd LaunchAgent on macOS, systemd
 * `--user` unit on Linux). No sudo, ever. Every step is idempotent: running
 * install twice with the same binary changes nothing and restarts nothing.
 */
import { createHash } from "node:crypto"
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
} from "node:fs"
import { homedir, userInfo } from "node:os"
import { basename, dirname, join } from "node:path"
import { Effect, Schema } from "effect"
import { defaultStateFile, stopAppServer } from "../harness/codex/AppServer.ts"
import { CommandRunner } from "./CommandRunner.ts"
import {
  LAUNCHD_LABEL,
  launchdPlist,
  type ServiceSpec,
  SYSTEMD_UNIT,
  systemdUnit,
} from "./templates.ts"

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  step: Schema.String,
  message: Schema.String,
}) {}

export type ServiceOs = "darwin" | "linux"

export interface InstallContext {
  readonly os: ServiceOs
  /** `~/.polaris` (or `POLARIS_HOME`). */
  readonly polarisHome: string
  /** The user's home directory, where `Library/LaunchAgents` or `.config/systemd` live. */
  readonly userHome: string
  /** `$XDG_CONFIG_HOME`, when set (Linux). */
  readonly xdgConfigHome: string | null
  readonly uid: number
  readonly user: string
  /** PATH for the service, so the Daemon finds Harnesses and git. */
  readonly path: string
}

export const defaultInstallContext = (polarisHome: string): InstallContext => {
  const info = userInfo()
  return {
    os: process.platform === "darwin" ? "darwin" : "linux",
    polarisHome,
    userHome: homedir(),
    xdgConfigHome: process.env.XDG_CONFIG_HOME ?? null,
    uid: info.uid,
    user: info.username,
    path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  }
}

export const layout = (ctx: InstallContext, version?: string) => {
  const bin = join(ctx.polarisHome, "bin")
  return {
    bin,
    current: join(bin, "current"),
    launcher: join(bin, "current", "polaris"),
    versionDir: version === undefined ? null : join(bin, version),
    installed: version === undefined ? null : join(bin, version, "polaris"),
    logs: join(ctx.polarisHome, "logs"),
    serviceFile:
      ctx.os === "darwin"
        ? join(ctx.userHome, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`)
        : join(ctx.xdgConfigHome ?? join(ctx.userHome, ".config"), "systemd", "user", SYSTEMD_UNIT),
  }
}

export const serviceSpec = (ctx: InstallContext): ServiceSpec => {
  const paths = layout(ctx)
  return {
    program: paths.launcher,
    args: ["serve"],
    home: ctx.polarisHome,
    logDir: paths.logs,
    env: { PATH: ctx.path },
  }
}

export const renderServiceFile = (ctx: InstallContext): string =>
  ctx.os === "darwin" ? launchdPlist(serviceSpec(ctx)) : systemdUnit(serviceSpec(ctx))

export const sha256File = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex")

export type LingerStatus = "enabled" | "already-enabled" | "needs-admin" | "not-applicable"

export interface InstallReport {
  readonly version: string
  readonly binary: string
  readonly sha256: string
  readonly binaryChanged: boolean
  readonly serviceFile: string
  readonly serviceFileChanged: boolean
  /** The launchd domain (`gui/501`, `user/501`) or `systemd --user`. */
  readonly serviceDomain: string
  readonly restarted: boolean
  readonly linger: LingerStatus
  readonly notes: ReadonlyArray<string>
}

const fsStep = <A>(step: string, f: () => A) =>
  Effect.try({ try: f, catch: (error) => new InstallError({ step, message: String(error) }) })

/** Copies `source` into place atomically; false if an identical file is already there. */
const placeFile = (source: string, target: string, sha256: string, mode: number) =>
  fsStep(`copy ${basename(target)}`, () => {
    if (source === target) return false
    if (existsSync(target) && sha256File(target) === sha256) return false
    mkdirSync(dirname(target), { recursive: true })
    const temp = `${target}.tmp-${process.pid}`
    copyFileSync(source, temp)
    chmodSync(temp, mode)
    renameSync(temp, target)
    return true
  })

/**
 * Copies `source` to `~/.polaris/bin/<version>/polaris` (a no-op if an
 * identical file is there). The binary is self-contained: native libraries
 * such as fff's are embedded by `bun build --compile`.
 */
export const stageBinary = Effect.fn("stageBinary")(function* (
  ctx: InstallContext,
  options: InstallOptions,
) {
  const path = layout(ctx, options.version).installed!
  const sha256 = yield* fsStep("hash binary", () => sha256File(options.source))
  const changed = yield* placeFile(options.source, path, sha256, 0o755)
  return { path, sha256, changed }
})

/** Points `current` at `version` with an atomic rename; false if it already did. */
export const pointCurrentAt = (ctx: InstallContext, version: string) =>
  fsStep("link current", () => {
    const { current } = layout(ctx)
    try {
      if (readlinkSync(current) === version) return false
    } catch {}
    const temp = `${current}.tmp-${process.pid}`
    rmSync(temp, { force: true })
    symlinkSync(version, temp)
    renameSync(temp, current)
    return true
  })

const writeIfChanged = (path: string, content: string) =>
  fsStep("write service file", () => {
    if (existsSync(path) && readFileSync(path, "utf8") === content) return false
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content, { mode: 0o644 })
    return true
  })

const run = Effect.fnUntraced(function* (argv: ReadonlyArray<string>) {
  const runner = yield* CommandRunner
  return yield* runner.run(argv)
})

const runOrFail = Effect.fnUntraced(function* (step: string, argv: ReadonlyArray<string>) {
  const result = yield* run(argv)
  if (result.code !== 0) {
    return yield* new InstallError({
      step,
      message: `\`${argv.join(" ")}\` exited ${result.code}: ${(result.stderr || result.stdout).trim()}`,
    })
  }
  return result
})

/**
 * Load (or reload) the LaunchAgent. `gui/<uid>` exists only while the user
 * is logged in at the console; over SSH to a Mac with nobody logged in we
 * fall back to the `user/<uid>` domain, which runs without a GUI session.
 */
const activateLaunchd = Effect.fnUntraced(function* (
  ctx: InstallContext,
  serviceFile: string,
  changed: { readonly binary: boolean; readonly serviceFile: boolean },
) {
  const notes: Array<string> = []
  let domain = `gui/${ctx.uid}`
  const loaded = (d: string) =>
    run(["launchctl", "print", `${d}/${LAUNCHD_LABEL}`]).pipe(Effect.map((r) => r.code === 0))
  let isLoaded = yield* loaded(domain)
  if (!isLoaded && (yield* loaded(`user/${ctx.uid}`))) {
    domain = `user/${ctx.uid}`
    isLoaded = true
  }
  if (isLoaded && !changed.serviceFile) {
    // Same definition: start it if stopped, restart only if the binary changed.
    const kick = changed.binary ? ["-k"] : []
    yield* runOrFail("start service", [
      "launchctl",
      "kickstart",
      ...kick,
      `${domain}/${LAUNCHD_LABEL}`,
    ])
    return { domain, restarted: changed.binary, linger: "not-applicable" as const, notes }
  }
  if (isLoaded) yield* run(["launchctl", "bootout", `${domain}/${LAUNCHD_LABEL}`])
  let boot = yield* run(["launchctl", "bootstrap", domain, serviceFile])
  if (boot.code !== 0 && domain.startsWith("gui/")) {
    notes.push(
      `No GUI login session (launchctl bootstrap ${domain}: ${boot.stderr.trim()}); using user/${ctx.uid}.`,
    )
    domain = `user/${ctx.uid}`
    boot = yield* run(["launchctl", "bootstrap", domain, serviceFile])
  }
  if (boot.code !== 0) {
    return yield* new InstallError({
      step: "load service",
      message: `launchctl bootstrap ${domain} exited ${boot.code}: ${boot.stderr.trim()}`,
    })
  }
  yield* run(["launchctl", "enable", `${domain}/${LAUNCHD_LABEL}`])
  yield* runOrFail("start service", ["launchctl", "kickstart", `${domain}/${LAUNCHD_LABEL}`])
  return { domain, restarted: isLoaded, linger: "not-applicable" as const, notes }
})

/**
 * Enable lingering so the user manager (and the Daemon) survives logout and
 * starts at boot. Allowed for oneself on most distributions when the session
 * is local; over SSH polkit often wants an administrator.
 */
const enableLinger = Effect.fnUntraced(function* (ctx: InstallContext) {
  const shown = yield* run(["loginctl", "show-user", ctx.user, "--property=Linger", "--value"])
  if (shown.code === 0 && shown.stdout.trim() === "yes") return "already-enabled" as const
  const enabled = yield* run(["loginctl", "enable-linger", ctx.user])
  return enabled.code === 0 ? ("enabled" as const) : ("needs-admin" as const)
})

const activateSystemd = Effect.fnUntraced(function* (
  ctx: InstallContext,
  changed: { readonly binary: boolean; readonly serviceFile: boolean },
) {
  const notes: Array<string> = []
  const systemctl = (...args: Array<string>) => ["systemctl", "--user", ...args]
  if (changed.serviceFile) yield* runOrFail("reload units", systemctl("daemon-reload"))
  const active = yield* run(systemctl("is-active", "--quiet", SYSTEMD_UNIT))
  yield* runOrFail("enable service", systemctl("enable", SYSTEMD_UNIT))
  const restart = active.code === 0 && (changed.binary || changed.serviceFile)
  yield* runOrFail("start service", systemctl(restart ? "restart" : "start", SYSTEMD_UNIT))
  const linger = yield* enableLinger(ctx)
  if (linger === "needs-admin") {
    notes.push(
      `Lingering is off, so the Daemon stops when ${ctx.user} logs out. An administrator can run: sudo loginctl enable-linger ${ctx.user}`,
    )
  }
  return { domain: "systemd --user", restarted: restart, linger, notes }
})

export interface InstallOptions {
  /** The compiled `polaris` binary to install (normally this process's own executable). */
  readonly source: string
  readonly version: string
}

export const install = Effect.fn("install")(function* (
  ctx: InstallContext,
  options: InstallOptions,
): Effect.fn.Return<InstallReport, InstallError, CommandRunner> {
  const paths = layout(ctx, options.version)
  yield* fsStep("create directories", () => mkdirSync(paths.logs, { recursive: true, mode: 0o700 }))
  const staged = yield* stageBinary(ctx, options)
  const sha256 = staged.sha256
  const binaryChanged = staged.changed
  const currentChanged = yield* pointCurrentAt(ctx, options.version)
  const serviceFileChanged = yield* writeIfChanged(paths.serviceFile, renderServiceFile(ctx))
  const changed = { binary: binaryChanged || currentChanged, serviceFile: serviceFileChanged }
  const activation =
    ctx.os === "darwin"
      ? yield* activateLaunchd(ctx, paths.serviceFile, changed)
      : yield* activateSystemd(ctx, changed)
  return {
    version: options.version,
    binary: staged.path,
    sha256,
    binaryChanged: changed.binary,
    serviceFile: paths.serviceFile,
    serviceFileChanged,
    serviceDomain: activation.domain,
    restarted: activation.restarted,
    linger: activation.linger,
    notes: activation.notes,
  }
})

export interface UninstallReport {
  readonly serviceFileRemoved: boolean
  /** PID of the shared Codex app-server that was stopped, if one was running. */
  readonly codexAppServerStopped: number | null
  readonly binariesRemoved: boolean
  readonly purged: boolean
}

/**
 * Stop and remove the user service and installed binaries. State (the event
 * store, logs, staging) stays unless `purge`, so a reinstall picks up where
 * it left off.
 */
export const uninstall = Effect.fn("uninstall")(function* (
  ctx: InstallContext,
  options: { readonly purge: boolean },
): Effect.fn.Return<UninstallReport, InstallError, CommandRunner> {
  const paths = layout(ctx)
  if (ctx.os === "darwin") {
    yield* run(["launchctl", "bootout", `gui/${ctx.uid}/${LAUNCHD_LABEL}`])
    yield* run(["launchctl", "bootout", `user/${ctx.uid}/${LAUNCHD_LABEL}`])
  } else {
    yield* run(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT])
  }
  // The shared Codex app-server outlives the Daemon on purpose; uninstall ends it.
  const appServer = yield* stopAppServer({
    stateFile: defaultStateFile(join(ctx.polarisHome, "codex.sock")),
    socketPath: join(ctx.polarisHome, "codex.sock"),
  })
  const serviceFileRemoved = yield* fsStep("remove service file", () => {
    const existed = existsSync(paths.serviceFile)
    rmSync(paths.serviceFile, { force: true })
    return existed
  })
  if (ctx.os === "linux" && serviceFileRemoved) {
    yield* run(["systemctl", "--user", "daemon-reload"])
  }
  const binariesRemoved = yield* fsStep("remove binaries", () => {
    const existed = existsSync(paths.bin)
    rmSync(options.purge ? ctx.polarisHome : paths.bin, { recursive: true, force: true })
    return existed
  })
  return {
    serviceFileRemoved,
    codexAppServerStopped: appServer.stopped,
    binariesRemoved,
    purged: options.purge,
  }
})

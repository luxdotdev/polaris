# Research: platform seams worth a single API

Audit of `main` on 2026-10-13 for platform-specific behaviour (macOS / Windows / Linux, the local Host vs an SSH Host vs a WSL Host, x64 vs arm64, glibc vs musl, Electron vs Bun) that is handled ad hoc and would be better behind one Effect `Context.Service` with per-platform Layers. Covered: `apps/daemon`, `apps/desktop` (main, preload, renderer, scripts), `packages/client`, `packages/protocol`, `scripts/`, `tooling/`. Read-only: nothing here was run on Windows or Linux, so findings marked *verify* are inferred from code and documented platform behaviour.

The motivating case, already approved, is `SecureStorage` (get/set/delete by namespaced key; an Electron `safeStorage` Layer and an in-memory test Layer), extracted from `apps/desktop/src/main/github/electron.ts`.

## TL;DR

- **The biggest seam isn't an OS. It's the kind of Host.** `HostTarget` (`Local | Ssh | Wsl`, `packages/client/src/HostConnection.ts:57`) already picks the transport. But the install flow, "Start daemon", "Open in terminal" and `install.ensure` all pick their command runner from the settings key and `LOCAL_HOST_KEY` checks, not from that type. That is the cause of the "no remote host \"local\"" bug, and two more of the same kind. A `HostAccess` service resolved from `HostTarget` (built on the existing `Ssh` service and its three Layers) fixes all of them.
- **The SecureStorage cut should also take the language credential.** `apps/desktop/src/main/languages/credential.ts` protects a secret with POSIX modes, uid and `O_NOFOLLOW` checks. On Windows these can never pass, so language identity is silently off on every Windows Client.
- **"Is there a local Host on this Client?" is answered in 9 places**, with the same "A local Windows Daemon is not supported." string written out 4 times. A `LocalHost` service with a POSIX Layer and an Unsupported Layer replaces them.
- **Child processes on the Client need one launcher.** Electron's main process spawns `ssh.exe` and `wsl.exe` without `windowsHide`. Two of the six call sites set it and four don't, so on Windows each connection and install command can open a console window (*verify*).
- **The Daemon works out its own platform (os, arch, libc) in about 11 places, three different ways.** The two musl checks can disagree: a glibc Debian/Ubuntu Host with the `musl` package installed reports itself as `linux-<arch>-musl`, while language tooling picks glibc (*verify*).
- Plenty of branches are fine as they are: trash, `stty -f/-F`, launchd vs systemd (already injected through `CommandRunner` and `ctx.os`), the renderer's `ClientPlatform`/`clientCopy`, Squirrel. See §3.

## 1. Candidate services, ranked

Value is roughly bugs prevented × call sites × upcoming work (Windows Client, WSL Hosts, Linux Client). Call sites are on `main` as of this audit.

| # | Proposed service | What it abstracts | Variants | Current call sites (count) | Existing partial abstraction | Risk if left as is |
|---|---|---|---|---|---|---|
| 1 | **`HostAccess`** (Client) | How the Client reaches a Host *outside* the Daemon connection: run a shell command, stream a file to it, open an interactive terminal on it, (re)start its Daemon | `HostTarget.Local` (installed `~/.polaris`, local `/bin/sh`), `Ssh` (system or configured ssh, Windows OpenSSH), `Wsl` (`wsl.exe --exec`); an unmanaged local Host (the app's own dev Daemon) | `machines/service.ts:183-222` (`remoteSetting`, `requireRemote`, `isWsl`, `target`, `requireCheckable`), `:379-405`, `:608-616`, `:640-644`, `:705-713`; `machines/index.ts:43-57,75-79`; `ipc/install.ts:62`; `ipc/requests.ts:244-250,412-418`; `hosts.ts:194-206`; `install/Ssh.ts:156-219`; `wsl/install.ts:41-60` (**~15**) | `Ssh` service with `withOptions` / `local` / `wslInstallLayer` Layers; `HostTarget` tagged enum; `connectorFor` already matches on `HostTarget` (`HostConnection.ts:206`) | Real bug: "Start daemon" on This Mac fails with `no remote host "local"` (B1). Two more of the same kind: B2, B3. Every new Host action (WSL reveal, a terminal on This Mac) adds another `key === LOCAL_HOST_KEY` / `isWsl` branch. |
| 2 | **`SecureStorage`** (Desktop main) | Secrets at rest: GitHub tokens, the language identity proof, future Harness/API keys | Electron `safeStorage` (Keychain / DPAPI / libsecret or kwallet; Linux `basic_text` refused), Unavailable, in-memory test | `github/electron.ts:15-27`; `github/store.ts:13-22,114-145,155`; `github/accounts.ts:55,229-232`; `languages/credential.ts:24-124`; `languages/optionalCredential.ts:4-12`; `index.ts:290` (**6**) | `Crypto` interface in `github/store.ts:13` (encrypt/decrypt/available) and its test stand-in | Bug B5: the language proof can never load on Windows. Each new secret will invent its own storage. |
| 3 | **`LocalHost`** (Desktop main) | Whether this Client has a local Host, and which Daemon serves it: the system socket, a dev Daemon, an explicit socket, its installed home, its label | POSIX (macOS, Linux Client), Unsupported (Windows today; later "default WSL distro"), test | `localDaemon.ts:39-46,135-200`; `machines/service.ts:150,196,215-222,510,618-638,650-651`; `machines/views.ts:84,89`; `index.ts:267-285,303-304`; `install/Ssh.ts:196-219`; `hosts.ts:143,173` (**~10**) | `localHostEnabled`, `resolveLocalDaemon`, `LocalDaemon` interface | The check is repeated, and the message string is written out 4 times. `"This Mac"` is the default label on a Linux Client. The Windows decision ("no local Host") can't be changed in one place. |
| 4 | **`ChildProcess`** (Client: Electron and Node) | Spawning helpers from the Client: no console window on Windows, kill semantics, spawn-failure classification, stdin streaming | Windows (`windowsHide`, no POSIX signals, `ENOENT` vs ssh-missing), POSIX, scripted test | `transport.ts:68-99,118`; `install/Ssh.ts:84-138`; `wsl/distros.ts:116-138`; `machines/terminal.ts:58-79`; `updates/squirrel.ts:46`; `localDaemon.ts:136`, `machines/builds.ts:55` (dev only) (**7**) | `runCommand` (`install/Ssh.ts:75`), `spawnTransport`; `Connector` is already injectable | Bug B4 (*verify*): console windows on Windows. Each call site decides `windowsHide` and failure classification for itself (B13). |
| 5 | **`HostPlatform`** (Daemon) | What this Host is: os, arch, libc, the build's platform id, the libc library path and the per-OS constants `bun:ffi` needs | darwin-arm64, linux-{x64,arm64}-{glibc,musl}; compiled (`POLARIS_LIBC` define) vs from source; test | `service/platform.ts:44-68`; `service/libc.ts:17-60`; `languages/media/native.ts:13-25,38`; `languages/composition/environment.ts:13-35`; `rules/patterns/native.ts:22-50`; `rules/secrets/fetch.ts:34`; `transport/hostInfo.ts:13-22,52`; `languages/discovery/typescript.ts:164`; `languages/projectFormat/launch.ts:16-33`; `service/install.ts:63`; `scripts/build-daemon.ts:182-189` (**~11**) | `currentPlatform()`, `runtimePlatform()`, `currentLanguagePlatform()`, protocol `Platform` and `LanguagePlatform` | Bug B8 (*verify*): musl is detected by "does `/lib/ld-musl-*` exist" in 4 places but glibc-first in `environment.ts`, and the compiled `POLARIS_LIBC` define is used for ast-grep only. There are three platform vocabularies (protocol `Platform` has 3 values, daemon `PLATFORMS` 5, `LanguagePlatform` is a struct), and they drift (B9). |
| 6 | **`DesktopShell`** (Desktop main) | OS integration: open a URL, reveal a path (by Host), open a terminal running argv, show the app bundle, pick a folder | macOS (Finder, `.command` → Terminal), Windows (Explorer, `wt.exe`/`cmd`, `\\wsl.localhost\…` for WSL Hosts), Linux (file manager, `x-terminal-emulator`/`$TERMINAL`), test | `machines/index.ts:43-57,74`; `machines/terminal.ts:12-92`; `index.ts:229-243,342-354`; `window.ts:64`; `ipc/requests.ts:239-250`; `shared/contract.ts:235`; `wsl/command.ts:54` (unused) (**~8**) | `openWindowsTerminal`, `clientCopy().reveal`, `revealAppPath` | Bug B6: the Linux Client's "Open in terminal" opens a `.command` file with `shell.openPath`. WSL Hosts can't reveal files even though `wslWindowsPath` exists. |
| 7 | **`FileWatcher`** (Daemon) | Watching a tree or a directory: native recursive (FSEvents) vs bounded per-directory (inotify), errors that mustn't kill the Daemon | darwin, linux, test | `files/search/watch.ts:16-31`; `git/WorktreeTracker.ts:258-285`; `usage/UsageIndex.ts:265-285`; `files/watch.ts:24-60`; `languages/runtime/configurationWatch.ts:180` (**5**) | `watchRoot` (injectable `platform` and `open`) | Policy drift: `search/watch.ts` refuses recursive watches off macOS (bounded instead), but `UsageIndex.ts:271` and `WorktreeTracker.ts:282` ask for `recursive: true` everywhere. On a Pi that is an inotify watch per directory under `~/.claude/projects` (B14, *verify*). |
| 8 | **`ProcessGroup`** (Daemon) | Spawn in its own process group with a deadline; kill the group (`kill(-pid)`, falling back to the pid); confirm the group is gone | POSIX only (the Daemon ships no Windows build); test | `languages/availability/version-process.ts:40-110`; `languages/projectFormat/run.ts:55-85`; `languages/runtime/process.ts:30-45`; `constellation/setup/process.ts:27-47`; `languages/catalog/shellcheck-probe.ts:58-72` (**5**) | none; each copy is slightly different | No platform bug today, just duplication: the same try `kill(-pid)` / catch `child.kill` block is written 5 times. Dead `win32` branches (§3) suggest people expect a Windows Daemon. If one comes, this is where it lands. |
| 9 | **`AppUpdater`** (Desktop main) | Update feed, preflight, version naming, "can't install here", first run | Squirrel.Mac (zip), Squirrel.Windows (nupkg, `Update.exe`), unsupported (Linux, dev) | `updates/index.ts:77,106-145,189`; `updates/identity.ts:31-56`; `updates/platform.ts:3-27`; `updates/squirrel.ts`; `updates/startup.ts:30-33`; `index.ts:79-81,174-188` (**~12**) | Pure functions with an injected `platform`; `native` updater injected | Low: it is already tested per platform. The view field `macOSVersion` holds the Windows version (B12). |
| 10 | **`ServiceManager`** (Daemon) | Keeping the Daemon running: launchd, systemd `--user`, the fallback supervisor | darwin, linux+systemd, linux fallback | `service/install.ts:41-108,521-548,583-603`; `launchd.ts`; `templates.ts` (**~8**) | `ServiceOs` on `InstallContext`, `CommandRunner` service, the pure `planLaunchd` / `planLinuxService` | Low: already injected and tested. A service only tidies `install`/`uninstall`. Worth doing only when a third manager (OpenRC, a Windows service) appears. |
| 11 | **`SystemResources`** (Daemon, Client, bench) | Available memory, chip, GPU, load, a process's command line | darwin (`vm_stat`, `sysctl`, `ps`), linux (`/proc`), win32 (Client only) | `languages/runtime/process-capacity.ts:41-70`; `harness/codex/AppServer.ts:114-133`; `client/prediction/probe.ts:44-60`; `bench/src/env.ts:33-42`; `bench/src/proc.ts:236-237` (**5**) | `machineFacts` (injectable in the predictor), `hostProcessResources` | Low: the Windows Client reports `gpu: null` even with CUDA, which matters only to the local prediction probe. |

## 2. The top five

All sketches follow AGENTS.md: `Context.Service`, `Effect.fn`, `Schema.TaggedError`, tagged values built with their constructors, matching through `Match`/`$match`. They are interfaces, not implementations.

### 2.1 `HostAccess`

Today the install flow's `Ssh` service is keyed by an "alias" string, and `Machines` picks the Layer from settings (`machines/service.ts:195-213`). `HostTarget` already says how to reach each Host. Make it say how to *act* on the Host too.

```ts
// packages/client/src/access/HostAccess.ts
export class HostUnreachable extends Schema.TaggedError<HostUnreachable>()("HostUnreachable", {
  target: Schema.String, // "ssh studio", "wsl Ubuntu", "local"
  failure: SshFailure, // host-key | auth | unreachable | spawn | unknown
  message: Schema.String,
}) {}

export class HostActionUnsupported extends Schema.TaggedError<HostActionUnsupported>()(
  "HostActionUnsupported",
  { target: Schema.String, action: Schema.String, reason: Schema.String }
) {}

/** One Host, already resolved: what the install flow, "Start daemon" and terminals use. */
export interface HostChannel {
  readonly describe: string;
  /** Runs a POSIX `sh` command line on the Host; fails only when the channel itself does. */
  readonly exec: (
    command: string,
    options?: { readonly stdinFile?: string; readonly onStdinBytes?: (bytes: number) => void }
  ) => Effect.Effect<SshResult, HostUnreachable>;
  /** argv the Client's terminal runs for an interactive shell there (`ssh -- a`, `wsl.exe -d d`). */
  readonly interactiveArgv: Effect.Effect<ReadonlyArray<string>, HostActionUnsupported>;
  /** Whether Polaris may install (not only upgrade) a Daemon through this channel. */
  readonly mayInstall: boolean;
}

export class HostAccess extends Context.Service<
  HostAccess,
  {
    readonly channel: (
      target: HostTarget,
      home: string | null
    ) => Effect.Effect<HostChannel, HostActionUnsupported>;
  }
>()("polaris/client/HostAccess") {
  /** ssh per `SshOptions`, wsl.exe per `WslOptions`, `/bin/sh` with HOME for an installed local Host. */
  static readonly layer = (options: { ssh: SshOptions; wsl: WslInstallOptions }) =>
    Layer.succeed(HostAccess, HostAccess.of({ channel: (target, home) => /* HostTarget.$match */ }));
  /** Scripted results per target, for Machines tests on any OS. */
  static readonly test = (script: (target: HostTarget, command: string) => SshResult) => /* … */;
}

// The daemon-level actions move onto the channel's user, unchanged in substance:
export const startDaemon = Effect.fn("startDaemon")(function* (channel: HostChannel) { /* … */ });
```

`Machines` stops holding `ssh`, `wsl.ssh` and `localHome` separately. It asks `HostDirectory` for the entry's `target`, then `HostAccess.channel(target, localHome)`. `channel` fails with `HostActionUnsupported` for a `Local` target with no installed home. That one place replaces `requireRemote`/`requireCheckable`/`target` and the `to.local` checks.

- **Layers:** `HostAccess.layer` (production: Ssh with `SshOptions` incl. the Windows OpenSSH binary, `wsl.exe`, local `sh`), `HostAccess.test` (scripted).
- **Test Layer:** extend `fakeHost.testing.ts` to answer per `HostTarget`, so `service.test.ts` can cover "Start daemon on This Mac" and the WSL cases. These tests then run on the Windows CI leg too, since nothing spawns.
- **Migration order:**
  1. Add `HostAccess` beside `Ssh` and implement it with the existing three Layers.
  2. Fix B1/B2 by routing `restart` (`startDaemon`) and `openSsh` through `channel`.
  3. Move `checkBody`/`planFor`/`applyWork` (`machines/remote.ts`, `install/remote.ts`) to take a `HostChannel`, not `alias` + `Ssh`.
  4. Delete or reroute `install.ensure` (B3).
  5. Retire `Ssh.local` and `wslInstallLayer` as public API.
  6. Key settings by `HostTarget`, not by bare alias (B11).

### 2.2 `SecureStorage`

```ts
// apps/desktop/src/main/secure/SecureStorage.ts
export const SecretKey = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+(\/[a-z0-9._-]+)+$/)); // "github/tokens/123"

export class SecureStorageUnavailable extends Schema.TaggedError<SecureStorageUnavailable>()(
  "SecureStorageUnavailable",
  { reason: Schema.Literals(["no-backend", "plaintext-backend", "blocked"]), message: Schema.String }
) {}

export class SecureStorageError extends Schema.TaggedError<SecureStorageError>()(
  "SecureStorageError",
  { key: Schema.String, message: Schema.String }
) {}

export class SecureStorage extends Context.Service<
  SecureStorage,
  {
    readonly available: Effect.Effect<boolean>;
    readonly get: (
      key: string
    ) => Effect.Effect<Option.Option<string>, SecureStorageError | SecureStorageUnavailable>;
    readonly set: (
      key: string,
      value: string
    ) => Effect.Effect<void, SecureStorageError | SecureStorageUnavailable>;
    readonly delete: (key: string) => Effect.Effect<void, SecureStorageError>;
  }
>()("polaris/desktop/SecureStorage") {
  /** safeStorage's async API over sealed files under `<dir>`; re-seals when `shouldReEncrypt`. */
  static readonly electron = (dir: string) => Layer.effect(SecureStorage, makeElectron(dir));
  static readonly memory = Layer.sync(SecureStorage, makeMemory);
  static readonly unavailable = (reason: SecureStorageUnavailable["reason"]) => /* … */;
}
```

- **Layers:**
  - `electron(dir)`. Keychain on macOS, DPAPI on Windows, libsecret or kwallet on Linux. It reports `plaintext-backend` when `getSelectedStorageBackend() === "basic_text"`. That is the check now at `github/electron.ts:17`, and it is the only `process.platform` read left in the service.
  - `memory` for tests.
  - `unavailable` for headless or bench runs.
- **Callers:** `github/store.ts` keeps `accounts.json` (not secret) as a plain file and moves token files to `SecureStorage` (`github/tokens/<id>`). `languages/credential.ts` stores the 32-byte proof as `languages/client-proof`. That removes the POSIX-only mode/uid/`O_NOFOLLOW` checks (B5) on every platform.
- **Migration order:**
  1. Service and its Layers.
  2. GitHub tokens, with a one-time read of the old `tokens/<id>.bin` files: same `safeStorage` sealing, so it's a rename.
  3. The language proof, keeping the old file reader on POSIX for one Release.
  4. Map `SecureStorageUnavailable.reason` straight to `clientCopy().noTokenStore` / `tokenStoreBlocked`.

### 2.3 `LocalHost`

```ts
// apps/desktop/src/main/local/LocalHost.ts
export class LocalHostUnsupported extends Schema.TaggedError<LocalHostUnsupported>()(
  "LocalHostUnsupported",
  { message: Schema.String } // from clientCopy, e.g. "this PC can't run a daemon"
) {}

export class LocalHostFailed extends Schema.TaggedError<LocalHostFailed>()("LocalHostFailed", {
  message: Schema.String,
}) {}

export class LocalHost extends Context.Service<
  LocalHost,
  {
    readonly supported: boolean;
    readonly label: string; // clientCopy-based: "This Mac", "This computer"
    /** Finds (or in dev, starts) the Daemon; idempotent. */
    readonly resolve: Effect.Effect<LocalDaemon, LocalHostUnsupported | LocalHostFailed>;
    /** The installed home it upgrades like a remote Host; None for the app's own dev Daemon. */
    readonly installedHome: Effect.Effect<Option.Option<string>>;
  }
>()("polaris/desktop/LocalHost") {
  static readonly posix = (options: { dev: boolean; repoRoot: string; env: NodeJS.ProcessEnv }) =>
    Layer.effect(LocalHost, makePosix(options));
  static readonly unsupported = Layer.succeed(LocalHost, /* supported: false, resolve fails */);
  static readonly test = (daemon: LocalDaemon | null) => /* … */;
}
```

- **Layers:**
  - `posix`: the body of `resolveLocalDaemon` / `startDevDaemon`.
  - `unsupported`: Windows today. Later it could become `wslDefault`, connecting This PC to the default distro.
  - `test`.
- The `index.ts` composition root picks the Layer once from `process.platform`. `Machines`, `machineViews`, `hostEntries` and `HostAccess` read `supported` and `label` from it. The four "A local Windows Daemon is not supported." strings and the `localHostEnabled(…, platform)` threading go away.
- **Migration order:**
  1. Wrap `localDaemon.ts` as the `posix` Layer, unchanged.
  2. Replace `localHostEnabled` readers.
  3. Make `hostEntries`/`machineViews` take `label` from the service; the Linux "This Mac" default goes (B7).
  4. Drop the platform guard in `Ssh.local`: `HostAccess` never builds a local channel without `LocalHost.installedHome`.

### 2.4 `ChildProcess` (Client)

```ts
// packages/client/src/process/ChildProcess.ts
export class SpawnFailed extends Schema.TaggedError<SpawnFailed>()("SpawnFailed", {
  file: Schema.String,
  code: Schema.String, // ENOENT, EACCES, …
  message: Schema.String,
}) {}

export interface Spawned {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  readonly exited: Effect.Effect<{ readonly code: number | null; readonly signal: string | null }>;
  /** Asks politely, then forces; SIGTERM/SIGKILL on POSIX, TerminateProcess on Windows. */
  readonly stop: (graceMs: number) => Effect.Effect<void>;
}

export class ChildProcess extends Context.Service<
  ChildProcess,
  {
    readonly spawn: (
      file: string,
      args: ReadonlyArray<string>,
      options: {
        readonly env?: Record<string, string | undefined>;
        readonly stdio: "pipe" | "ignore-stdin";
        /** A visible console is wanted (a terminal window); default hidden. */
        readonly visible?: boolean;
        readonly verbatimArguments?: boolean;
      }
    ) => Effect.Effect<Spawned, SpawnFailed, Scope.Scope>;
  }
>()("polaris/client/ChildProcess") {
  static readonly node = (platform: NodeJS.Platform = process.platform) => /* windowsHide: !visible */;
  static readonly test = (script: ScriptedProcesses) => /* … */;
}
```

- **Layers:** `node` (Electron main and Node; `windowsHide: true` unless `visible`, with signal mapping), `test` (scripted exits and stderr, replacing the ad hoc fakes in `fakeWsl.testing.ts` and the ssh shell fixtures that make the client suite POSIX-only on CI).
- `spawnTransport`, `runCommand`, `runList`, the terminal launcher and Squirrel use it. `spawnFailureReason` moves next to `HostTarget` ("ssh-missing" for any `Ssh` target, whatever binary path), which fixes B13.
- **Migration order:**
  1. Add the service and switch `transport.ts` and `install/Ssh.ts` first (B4).
  2. Then `wsl/distros.ts`, then `machines/terminal.ts` (`visible: true`).
  3. Then widen the Windows CI test list (`ci.yml:51-58`) to the client suites that become spawn-free.

### 2.5 `HostPlatform` (Daemon)

```ts
// apps/daemon/src/platform/HostPlatform.ts
export const Libc = Schema.Literals(["none", "glibc", "musl"]);

export class UnsupportedHost extends Schema.TaggedError<UnsupportedHost>()("UnsupportedHost", {
  os: Schema.String,
  arch: Schema.String,
  message: Schema.String,
}) {}

export class HostPlatform extends Context.Service<
  HostPlatform,
  {
    readonly os: "darwin" | "linux";
    readonly arch: "arm64" | "x64";
    readonly libc: typeof Libc.Type;
    /** The build id `polaris version` prints and `upgrade` checks: "linux-x64-musl". */
    readonly buildId: Platform; // service/platform.ts PLATFORMS
    /** What the wire says (protocol `Platform` today drops libc). */
    readonly wire: typeof ProtocolPlatform.Type;
    readonly language: typeof LanguagePlatform.Type;
    /** For bun:ffi: the libc to dlopen and the constants that differ by OS. */
    readonly libcPath: string;
    readonly constants: { readonly O_CLOEXEC: number; readonly FIOCLEX: bigint; /* … */ };
  }
>()("polaris/daemon/HostPlatform") {
  /** Compiled builds: libc from `process.env.POLARIS_LIBC` (a build-time constant), never sniffed. */
  static readonly live = Layer.effect(HostPlatform, detect);
  static readonly test = (fixed: Partial<HostPlatform["Service"]>) => /* … */;
}
```

- **Layers:**
  - `live` takes libc from the compiled-in `POLARIS_LIBC` when present: the process's own libc, which is what the README says the platform means. From source it falls back to the glibc-loader-first check that `environment.ts` already does.
  - `test`.
- **Callers:** `versionLine`, `hostInfo`, `languages/*`, `rules/patterns/native.ts` (the `require` branches stay literal for the bundler, chosen by `buildId`), `media/native.ts` and `service/libc.ts`. `libc.ts` is a module, not an Effect service, so the constants can live in a plain module that `live` also reads. The aim is one detection, not more Effect.
- **Protocol:** decide whether `HostInfo.platform` carries libc (B9). Either widen protocol `Platform` to the five build ids, or add `libc` beside it, so the Client stops mixing the two vocabularies.
- **Migration order:**
  1. Make `isMusl()` use `POLARIS_LIBC` when compiled (B8 in one line).
  2. Introduce the module and service and move the five detectors onto it.
  3. Change the protocol, with a spec/README check per AGENTS.md if `hello` changes.
  4. Align the Client probe (`install/remote.ts:31`) with the same rule: glibc loader first, then musl.

## 3. Platform branches that are fine as they are

These are one-offs, already isolated or injected, or deliberate product limits. Don't abstract them.

- **Renderer platform:** `shared/platform.ts` (`ClientPlatform`, passed main → preload → renderer) and `shared/clientCopy.ts`. This is the seam, done right. The fix is to route the stragglers in B7 through it, not to add a service.
- **Window chrome, menu, tray, badge, keymap:** `main/chrome.ts`, `window.ts:47-80`, `tray/index.ts:30-43`, `notifications/badge.ts:13`, `shared/chord.ts`, `shared/keymapPlatforms`. Pure, platform passed in, tested.
- **macOS hide-on-close:** `index.ts:393` and `setAppUserModelId` at `index.ts:81`. One line each, Electron-mandated.
- **ssh config parsing:** `machines/sshConfig.ts` (Windows `%VAR%`/`${VAR}`, drive roots, `win32` joins). Platform injected, well tested.
- **`ssh.ts`:** the ControlMaster omission on Windows and `resolveSshBinary`. Pure and tested (`windowsSsh.test.ts`). They move under `HostAccess.layer` unchanged.
- **WSL modules:** `wsl/command.ts`, `wsl/output.ts`, `wsl/distros.ts`. Already a clean per-target module (ADR 0036). `HostAccess` wraps them.
- **Trash:** `files/trash.ts`. One function and one flag (`supportsTrash`), already the only place.
- **PTY resize:** `terminal/Terminals.ts:365`, `stty -f` vs `-F`. One line, documented (`terminal/README.md`: `ioctl` is variadic under `bun:ffi`).
- **Service management:** `service/install.ts`, `launchd.ts`, `templates.ts`. `ServiceOs` and `CommandRunner` are already injected and planned purely. Revisit only with a third service manager (#10 above).
- **Codex app-server:** `harness/codex/AppServer.ts:172-176`, `systemd-run` only under systemd (`INVOCATION_ID`). A real systemd behaviour, documented in its README.
- **Small policy tweaks:** `files/search/fallback.ts:33` (`gitGrepThreads` on darwin) and `reviewer/policy.ts:10` (`canRunChecks`: bubblewrap/socat on Linux). Platform injected.
- **Build and CI tooling:** `scripts/build-daemon.ts`, `scripts/manual-install.ts`, `apps/desktop/scripts/*` (package, budgets, smoke, dev bundle), `packages/spec/scripts/fetch-evaluator.ts`, `packages/bench/*`, `tooling/lsp-feasibility`, `tooling/hooks`. These run on developer machines and CI, and their branches are what they build for. The `musl` sniff in `build-daemon.ts:182` only picks the *host* build to selftest.
- **Dead `win32` branches in the Daemon:** `files/edits/paths.ts:13`, `languages/runtime/process.ts:30,37`, `languages/availability/version-process.ts:78`. They're harmless, but the Daemon ships no Windows build. Replace the first with `path.sep` and leave the rest, or drop them when touching those files. Don't build a Windows Layer for them.
- **Shipped platforms:** no `darwin-x64` Daemon or Desktop App, and Linux has no update feed (`updates/platform.ts:3`). These are product decisions (ENG-181), not seams.
- **Host-side POSIX argv built in the renderer:** `review/checkout/model/run.ts:50` (`loginShellArgv`) and `attachments/model.ts:57` (`copyArgv`) assume a POSIX Host. Every Host is POSIX (WSL included). They would be better as Daemon RPCs someday, but that isn't a platform seam.

## 4. Bugs found along the way

| # | Where | What | Fix idea |
|---|---|---|---|
| B1 | `apps/desktop/src/main/machines/service.ts:608-616` | `restart` (`machines.startDaemon`) calls `requireRemote(key)`, so "Start daemon" on This Mac fails with `no remote host "local"`. That is the bug just reported. | Guard like `requireCheckable` and run `startDaemon` on `target(key)`; with `HostAccess`, on the local channel. |
| B2 | `machines/service.ts:195-213` | `target()` falls through to plain ssh with alias `"local"` when the local Host has no installed home. Any path that skips `requireCheckable` (B1 once its guard is loosened, `restart`'s `Effect.provide(target(key).ssh)`) would run `ssh local …`. | Make `target` return a tagged result and fail for an unmanaged local Host (`HostActionUnsupported`). |
| B3 | `apps/desktop/src/main/ipc/install.ts:62`, `ipc/requests.ts:412-418` | `install.ensure` always provides `Ssh.layer`. It ignores `settings.sshBinary` and the Windows OpenSSH path options, sends WSL distro names to `ssh`, and reports `Local` for every `alias === null` Host, extras included. No renderer caller exists. | Delete the IPC, or route it through `Machines.check` and `HostAccess`. |
| B4 | `packages/client/src/transport.ts:68`, `packages/client/src/install/Ssh.ts:85` | *Verify on the Windows test build.* `spawn` of `ssh.exe`/`wsl.exe` from Electron's GUI main process sets no `windowsHide`, so Windows can give each child a console window. One persists per Host connection, plus one per install command. `wsl/distros.ts:121` and `updates/squirrel.ts:46` do set it. | `windowsHide: true` in one Client spawn helper (`ChildProcess`, §2.4). |
| B5 | `apps/desktop/src/main/languages/credential.ts:24-50,79-104` | The language proof requires `mode & 0o777 === 0o700/0o600`, `uid === process.getuid()` (undefined on Windows) and `O_NOFOLLOW`/`O_DIRECTORY` (undefined on Windows). It always throws on Windows, so `optionalCredential.ts` silently disables language identity on every Windows Client. | Keep the proof in `SecureStorage` (§2.2), or give Windows a Layer that trusts the per-user `userData` ACL. |
| B6 | `apps/desktop/src/main/machines/index.ts:43-57` | Any non-Windows platform writes `polaris.command` and calls `shell.openPath`. That runs in Terminal only on macOS. On a Linux Client it opens the script in an editor, or does nothing. | A Linux branch (`$TERMINAL`, `x-terminal-emulator`, `gnome-terminal --`) behind `DesktopShell.openTerminal`, or report unsupported. |
| B7 | Renderer: `features/machines/wsl.ts:93-96` (`hostsIntro` uses "has WSL" as a proxy for Windows, so a PC without WSL reads "this Mac installs and upgrades them"), `wsl.ts:83`, `machines/model.ts:105,316`, `machines/updates/quiet.ts:43`, `session/model/polarisTools/session.ts:134`, `open-folder/rows.ts:89` ("Choose in Finder…"), `shell/hostCopy.ts:88`. Main: `editorDirty.ts:50`, `github/accounts.ts:231`, `machines/service.ts:89,97,221`, `hosts.ts:143,173`, `machines/views.ts:84` | Hard-coded "this Mac" / "Finder" / "This Mac" bypasses `clientCopy`. Windows users see Mac copy, and the Linux Client's local Host is called "This Mac". | Use `clientCopy().machine` / `.reveal` and a `LocalHost.label`. Make `hostsIntro` take the platform, not the WSL flag. |
| B8 | `apps/daemon/src/service/platform.ts:46-56`, `service/libc.ts:23-35`, `rules/patterns/native.ts:22-28`, `packages/client/src/install/remote.ts:31` vs `languages/composition/environment.ts:24-34` | *Verify on a Debian/Ubuntu Host with `apt install musl`.* "Any `/lib/ld-musl-*` exists" marks a glibc Host as musl. Then `polaris version` prints `linux-<arch>-musl` from a glibc build, the Client probe plans the musl build, `libc.ts` dlopens musl's loader inside a glibc process, and `environment.ts` (glibc-first) disagrees with all of them. | Compiled builds take libc from the `POLARIS_LIBC` define, as ast-grep already does. Detection from source and in the probe should check the glibc loader first. |
| B9 | `packages/protocol/src/domain.ts:55` vs `apps/daemon/src/service/platform.ts:15`; used at `apps/desktop/src/main/machines/views.ts:65-72` | `HostInfo.platform` drops libc (`linux-x64`), while builds and plans are keyed `linux-x64-musl`. Before a check runs, `versionFor` looks up a musl Host's bundled version under the glibc id. | One platform id across the protocol and builds, or a `libc` field on `HostInfo` (§2.5). |
| B10 | `machines/service.ts:600` | `approve` always shows `PROBING` ("Asking over SSH…"), also for WSL and This Mac. | Use `target(key).probing`, as `runCheck` does. |
| B11 | `machines/service.ts:535-539`, `hosts.ts:145` | Hosts are keyed by bare alias. An ssh alias named `local` is accepted, then silently dropped by `hostEntries`, and it collides with `LOCAL_HOST_KEY` in views and `updatePolicy` (`updateFacts.ts:19`). A WSL distro and an ssh alias with the same name can't both be added. | Reserve `local` in `add`, or key by `HostTarget` (`ssh:studio`, `wsl:Ubuntu`). |
| B12 | `apps/desktop/src/main/index.ts:178`, `updates/index.ts:89,106-109` | On Windows, `process.getSystemVersion()` is stored as `macOSVersion` and sent as `X-Polaris-Windows-Version`. Only the name is wrong, but the update view shows it as a macOS version. | Rename to `osVersion`. |
| B13 | `packages/client/src/transport.ts:117-118` | A missing ssh counts as `ssh-missing` only when argv[0] is literally `"ssh"`. A configured `sshBinary` (Git Bash) that is missing reads `command-missing`. | Take the reason from the target kind, not the binary name. |
| B14 | `apps/daemon/src/usage/UsageIndex.ts:271`, `git/WorktreeTracker.ts:282` | *Verify on a Pi.* `recursive: true` watches on Linux, against the bounded-watch policy in `files/search/watch.ts:21-31`. On Linux, Bun walks the tree with one inotify watch per directory, which can use up `max_user_watches` under a large `~/.claude/projects`. | One `FileWatcher` policy (#7): native recursive on darwin, bounded on linux. |
| B15 | `apps/desktop/src/shared/contract.ts:235`, `ipc/requests.ts:244-250`; `packages/client/src/wsl/command.ts:54` | Reveal is limited to the local Host and POSIX paths, so on Windows (no local Host) it is never available. `wslWindowsPath` (`\\wsl.localhost\<distro>\…`) exists but nothing calls it. | `DesktopShell.reveal(target, path)` with a WSL branch. This is a gap, not a regression. |
| B16 | `apps/desktop/src/renderer/features/open-folder/rows.ts:83`, `review/checkout/useCheckout.ts:43`, `shell/sidebar/Sidebar.tsx:278`, `empty/ui/HostStage.tsx:100` | "Local" is inferred from `alias === null`, which is also true for `POLARIS_DESKTOP_EXTRA_HOSTS` socket Hosts. `HostView` has no `kind`, though `MachineView` does. | Put `kind: "local" | "ssh" | "wsl"` on `HostView` and branch on it with `Match`. |

## Method

Grepped for `process.platform`, `os.platform()`, `win32`/`darwin`/`linux`, `path.sep` and `win32.`/`posix.`, `homedir()`, `.exe`, `launchctl`/`systemd`/`schtasks`, `security`/`osascript`, `open`/`xdg-open`, `/bin/sh`/`cmd.exe`/`powershell`, `chmod`/modes, signals and `kill(-pid)`, `\r\n`, `Bun.Terminal`/`stty`, `fs.watch`, `which`, `PATH`, `wsl`, `musl`/arch, `isPackaged`, `windowsHide`, `LOCAL_HOST_KEY`/`alias === null`/`"local"` and hard-coded "Mac" copy. Then I read each hit in context, and the CI matrix (`.github/workflows/ci.yml`; the Windows leg runs a hand-picked test list). No GPL/AGPL code was read.

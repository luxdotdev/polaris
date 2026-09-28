# Daemon lifecycle: builds, install, upgrade

Everything that gets a `polaris` binary onto a Host, keeps it running as a user service, and replaces it in place. Decisions: ENG-179 and ENG-181.

| File | What |
|---|---|
| `platform.ts` | `VERSION` (from `apps/daemon/package.json`), the three shipped platforms, `polaris version` output and its parser. |
| `templates.ts` | Pure launchd plist and systemd `--user` unit renderers. |
| `install.ts` | `install` / `uninstall` / `stageBinary` / `pointCurrentAt`. |
| `CommandRunner.ts` | Service for running `launchctl`, `systemctl`, `loginctl` and `<binary> version`; tests replace it. |
| `libc.ts` | `bun:ffi` bindings: `execve`, close-on-exec, `poll`/`accept`, `socketpair`, `waitpid`. |
| `upgrade.ts` | The execve hand-off: `prepareHandoff`, `execInto`, `adoptListener`, `bindAtomically`, `serveUpgrades`, `requestUpgrade`. |
| `selftest.ts` | `polaris selftest`: checks that the embedded fff library loads and searches on this Host. |
| `cli.ts` | The `install`, `uninstall` and `upgrade` subcommands wired into `main.ts`. |

## Builds

`bun run build` (the turbo `build` task of `@polaris/daemon`, via `scripts/build-daemon.ts`) writes:

```
apps/daemon/dist/manifest.json        version, commit, fff version, SHA-256 and size per platform
apps/daemon/dist/<platform>/polaris   bun build --compile --target=bun-<platform>, self-contained
```

for `darwin-arm64`, `linux-x64` and `linux-arm64` (glibc), and `linux-x64-musl` and `linux-arm64-musl` (musl, for Alpine). The build runs `polaris selftest` on the host platform's binary. CI runs it on each glibc Linux binary on native runners (not yet on the musl ones).

On Linux the platform names the libc: a musl process reports `linux-<arch>-musl` (`runtimePlatform()` in `platform.ts`, from `/lib/ld-musl-*`), which is what `polaris version` prints and `polaris upgrade` checks. Bun's musl runtime links `libstdc++.so.6` and `libgcc_s.so.1` dynamically, so an Alpine Host needs `apk add libstdc++ libgcc` (root); the Client's probe checks for them. `HostInfo.platform` (protocol) still says `linux-x64` / `linux-arm64`.

- **darwin needs re-signing.** Bun 1.3.13 appends the bundle after linking, which leaves the linker's ad-hoc signature invalid, and this macOS SIGKILLs the binary on exec (exit 137). The build runs `codesign --force --sign -`, so darwin builds must run on macOS (CI does).
- **fff's native library is embedded.** The files workstream uses `@ff-labs/fff-bun` (bun:ffi). It imports `@ff-labs/fff-bin-<platform>/libfff_c.*` with `{ type: "file" }`, so `--compile` embeds the library and loads it from `$bunfs`; no file ships beside the binary. That needs two things at build time:
  1. The **target's** `@ff-labs/fff-bin-*` package installed. Optional dependencies for other platforms are not installed by default, and the bundler then fails with "Could not resolve". When one is missing, the build runs `bun install --frozen-lockfile --os=* --cpu=*`, which installs every platform's optional packages from the lockfile without changing it.
  2. `--define FFF_LIBC="gnu"` (or `"musl"`) for the Linux targets, or fff falls back to git grep at runtime. fff ships `fff-bin-linux-{x64,arm64}-musl`.

  Verified: the darwin binary copied outside the repo (no `node_modules` nearby), the linux-arm64 binary in a Debian container, and the linux-arm64-musl binary in Alpine 3.24 (with `libstdc++ libgcc`) all print `fff: ok` from `polaris selftest`. `POLARIS_FFF=off polaris selftest` exits 1.

## Install (`polaris install`)

No sudo; everything under `~/.polaris/` (`POLARIS_HOME`). Each step is idempotent: a second run with the same binary changes nothing and restarts nothing.

1. Copy the binary to `~/.polaris/bin/<version>/polaris`: write a temp file, then rename. It is skipped if the SHA-256 already matches. Renaming matters on macOS: overwriting a signed binary in place gets it killed.
2. Point `~/.polaris/bin/current` at `<version>` with an atomic symlink rename. The service always runs `~/.polaris/bin/current/polaris serve`.
3. Write the service file only if its content changed:
   - macOS: `~/Library/LaunchAgents/dev.lux.polaris.plist`, with `RunAtLoad` and `KeepAlive`, logs at `~/.polaris/logs/daemon.{out,err}.log`, and `POLARIS_HOME` and `PATH` set. It bootstraps into `gui/<uid>`. Over SSH to a Mac with nobody logged in at the console, that domain does not exist, so it falls back to `user/<uid>` and says so in `notes`.
   - Linux: `~/.config/systemd/user/polaris.service` (`$XDG_CONFIG_HOME` honoured), with `Restart=always`. Then `daemon-reload`, `enable` and `start` (or `restart` if the binary or unit changed while it was running), then `loginctl enable-linger $USER`. If polkit refuses linger (common over SSH), the report says `linger: "needs-admin"` and gives the exact `sudo loginctl enable-linger <user>` for an administrator to run. The Daemon still runs, but it stops at logout.
   - Linux **without a systemd user bus** (`systemctl --user show-environment` fails: minimal containers, SSH sessions without `pam_systemd`, non-systemd distributions): Polaris' own **fallback supervisor**, decided by `planLinuxService` (pure, unit-tested). `~/.polaris/bin/polaris-supervise` (a POSIX sh script, `supervisorScript` in `templates.ts`) detaches itself (`setsid`, else `nohup`), keeps one instance through `~/.polaris/supervisor.pid`, runs `polaris serve`, restarts it when it exits (1 s backoff doubling to 60 s, reset after a minute up), and stops quietly when the Daemon exits 75 (another Daemon holds the lock) or the binary is gone. It comes back after a reboot through a `@reboot` crontab line when `crontab -l` works, and at login through a line in `~/.profile` (and `~/.bash_profile` / `~/.bash_login` when they exist); both lines end with `# polaris-supervisor`. Installing a new binary SIGTERMs the running Daemon and the supervisor restarts it on `current`. The report says `supervisor: "fallback"`, `autostart: ["cron", "profile"]` (or just `["profile"]`), `serviceDomain: "polaris-supervisor"`, and explains itself in `notes`. `polaris uninstall` stops the supervisor and its Daemon and removes both lines (keeping the rest of the crontab and profile). Verified end to end in Debian 13 (glibc, no cron) and Alpine 3.24 (musl, busybox cron): install, `kill -9` of the Daemon (restarted within a second), idempotent reinstall (still one supervisor), uninstall.
4. `polaris install --json` prints the report as one JSON line for the Client, including `supervisor` (`launchd`, `systemd` or `fallback`) and `autostart`.

`polaris uninstall [--purge]` stops and removes the service and `~/.polaris/bin`, stops the shared Codex app-server (which otherwise outlives the Daemon), and keeps the event store and logs unless `--purge` is passed.

A real install on your machine is only done by hand: `POLARIS_MANUAL_INSTALL=1 bun scripts/manual-install.ts [--uninstall]`.

## Upgrade: the execve hand-off (`polaris upgrade <path>`)

The Client uploads the new build and runs `~/.polaris/bin/current/polaris upgrade <uploaded path>` over SSH. That command:

1. validates the new binary (`<path> version` must print this Host's platform);
2. stages it as `~/.polaris/bin/<version>/` and repoints `current`, so a later crash-restart also comes up on the new version;
3. if a Daemon is running (`~/.polaris/daemon.pid` names a live process), writes `~/.polaris/upgrade-request.json` and sends it `SIGUSR2`, then waits for `~/.polaris/upgrade-status.json` to report `done` from the same PID. If no Daemon is running, it just (re)starts the service.

The running Daemon (`serveUpgrades`) validates the binary again, collects the fds to keep, clears close-on-exec on them, and `execve`s into the new binary in the same PID. It passes the hand-off in `POLARIS_HANDOFF` (listener fd, named fds, child PIDs, and the version it came from). launchd and systemd see nothing change. SQLite needs nothing special: an exec is like a crash to it, and committed transactions are durable.

### What Bun can and cannot do (proven in `upgrade.test.ts`, on macOS and Linux arm64)

| Question | Answer |
|---|---|
| Get a listener's fd | Yes: `listener.fd` on `Bun.listen` and `node:net` servers (missing from the types; use `listenerFd()`). |
| execve from Bun | Yes, via `bun:ffi` (also inside `bun build --compile` binaries). |
| Clear FD_CLOEXEC | Yes, with `ioctl(fd, FIONCLEX)`. `fcntl(F_SETFD)` is variadic, and on Apple arm64 a fixed-arity FFI binding would pass the argument in the wrong place. |
| Adopt an inherited listener with `Bun.listen({ fd })` / `net.Server#listen({ fd })` | **No**: "Bun does not support listening on a file descriptor". |
| Wrap an inherited or accepted *connected* socket fd | Yes: `Bun.connect({ fd })` (`connectFd()`); `new net.Socket({ fd })` does not work. |
| Keep a Harness child across the exec | Yes: it stays our child (same PID). Its stdio must be a socketpair we created (`socketPair()`), because `Bun.spawn` does not expose its pipe fds. After the exec, re-wrap our end with `connectFd` and reap the child with `reapChild` (the new runtime does not know it). |

Because a listener cannot be adopted, `adoptListener` + `bindAtomically` do this instead. The new image binds a fresh listener at `daemon.sock.<pid>.new` and renames it over `daemon.sock` (atomic). It then `accept`s whatever is queued on the inherited listener, plus anything arriving in a 250 ms grace period, hands each fd to the transport, and closes the old listener. The test hammers the socket through the switch and sees **no refused connection**. A connection the old image accepted just before the exec is closed by the exec, and the Client resumes with `afterSequence` as after any reconnect.

No supervisor fallback is needed. If one ever is (e.g. a platform where exec from a threaded runtime misbehaves), the fallback is a tiny stable process that owns the socket and the Harness socketpairs and passes them to each new Daemon over `SCM_RIGHTS`.

### Interface for the transport workstream

```ts
// startup, inside `polaris serve`
const adopted = yield* adoptListener()                   // null on a cold start
const server = yield* bindAtomically(paths().socket, (tmp) =>
  Effect.sync(() => Bun.listen({ unix: tmp, socket: handlers })))
if (adopted) yield* adopted.drain((fd) => void connectFd(fd, handlers))
yield* serveUpgrades({
  listenerFd: () => listenerFd(server),
  collect: () => Effect.succeed({ fds: { ... }, children: { ... } }),  // Harness socketpairs
  beforeExec: Effect.void,                                            // flush anything pending
})
```

`fixtures/handoff-daemon.ts` is a complete working example. If the transport uses `effect/socket` (built on `node:net`), bind it at the temporary path the same way. Adopted connections must still be wrapped with `Bun.connect({ fd })`.

### Hand-off contributors

A module with fds or children to keep registers a `HandoffContributor` for the life of its scope (`registerHandoffContributor`): `collect` returns named fds and children (merged with `hooks.collect`), `beforeExec` writes any state the new image needs, and `abort` undoes it if the exec fails. The terminals use this to keep PTYs across upgrades (`terminal/README.md`); the engine registers one with no fds whose `beforeExec` is `Engine.prepareForUpgrade`, which closes in-process (Claude) Harnesses per the recovery rule (`store/README.md`). After the exec, `takeHandoff()` returns the same names.

`libc.ts` loads glibc's `libc.so.6`, or on a musl Host the loader `/lib/ld-musl-<arch>.so.1` (musl's libc; there is no `libc.so.6`). The hand-off tests pass on Alpine arm64.

### Interface for the Harness workstream

The Codex app-server does not use this: it is started detached, not as the Daemon's child, and the new image re-adopts it through its socket (`harness/codex/README.md`, "App-server lifecycle"), so it also survives crashes and service restarts. A Harness child that must survive an upgrade but not a crash would be spawned with `const [ours, theirs] = socketPair(); Bun.spawn(argv, { stdio: [theirs, theirs, "inherit"] }); closeFd(theirs)`. Our end is then used through `connectFd(ours, …)`. `collect` reports `{ fds: { "harness:<sessionId>": ours }, children: { "harness:<sessionId>": pid } }`, and after the exec `takeHandoff()` returns them. A Harness whose protocol state lives in our process (the Claude Agent SDK) cannot be re-attached. Close it before the exec (the Agent Session goes Dormant) and resume it by cursor afterwards.

## Known gaps / TODO

- `daemon.pid` is written by `serveUpgrades`. Reconcile it with the transport's `daemon.lock` (one file could do both).
- Not yet in `polaris serve`: the transport owns `serve`, so the hand-off is wired only in the test fixture until then.
- Harness fds are named by convention (`harness:<sessionId>`); the Harness registry has to provide `collect`.
- `StandardOutput=append:` in the systemd unit cannot quote paths, so a `POLARIS_HOME` with spaces breaks logging on Linux.
- Fallback supervisor: with no usable crontab (or no cron daemon running at boot), nothing starts the Daemon after a reboot until the user logs in or the Client reinstalls. `polaris bridge` exits 69 when no Daemon answers; it could run `~/.polaris/bin/polaris-supervise` when that exists and retry, which would close the gap (transport's call).
- Fallback supervisor: a login profile hook only runs for login shells; `ssh host cmd` does not read `~/.profile`.
- The upgrade request is authenticated only by filesystem permissions (the files are mode 0600 under the user's home), which is enough for a per-user Daemon.
- Only macOS arm64 and Linux arm64 were exercised locally. linux-x64 is exercised by CI's smoke job.

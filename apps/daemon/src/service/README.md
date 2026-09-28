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
| `native.ts` | Where fff's native library is loaded from (`fffLibraryPath()`). |
| `cli.ts` | The `install`, `uninstall` and `upgrade` subcommands wired into `main.ts`. |

## Builds

`bun run build` (the turbo `build` task of `@polaris/daemon`, via `scripts/build-daemon.ts`) writes:

```
apps/daemon/dist/manifest.json               version, commit, SHA-256 and size of every file
apps/daemon/dist/<platform>/polaris          bun build --compile --target=bun-<platform>
apps/daemon/dist/<platform>/libfff_c.{dylib,so}
```

for `darwin-arm64`, `linux-x64` (glibc) and `linux-arm64` (glibc). The script checks the host's build with `polaris version`.

- **darwin needs re-signing.** Bun 1.3.13 appends the bundle after linking, which leaves the linker's ad-hoc signature invalid, and this macOS SIGKILLs the binary on exec (exit 137). The build runs `codesign --force --sign -`, so darwin builds must run on macOS (CI does).
- **fff's native library ships beside the binary.** `@ff-labs/fff-node` (MIT) loads `libfff_c` through `ffi-rs`, finding it in the platform package `@ff-labs/fff-bin-<platform>` next to itself in `node_modules`. That lookup cannot work inside a compiled binary (`/$bunfs/`), and `--compile` cannot embed a `dlopen`ed library. The build copies the right library from `@ff-labs/fff-bin-{darwin-arm64,linux-x64-gnu,linux-arm64-gnu}` (from `node_modules` for the host, otherwise from the npm tarball, checked against the registry's SHA-512 integrity). The fff version is the one installed for `@polaris/daemon`, or 0.11.0 until the files workstream adds the dependency.

### For the files workstream: loading fff

Call `fffLibraryPath()` from `native.ts`. It returns `$POLARIS_FFF_LIB` if set, otherwise `dirname(process.execPath)/libfff_c.{dylib,so}` when running compiled, or `null` when running from source (then let fff-node resolve its npm package as usual). Two caveats:

1. fff-node's JS wrapper hardcodes its own lookup (`findBinary()`) and has no path option, so in the compiled Daemon either `dlopen` `libfff_c` with `bun:ffi` directly (the C API is small), or use fff-node's `ffi-rs` `open({ library, path })` with our path before calling it.
2. `ffi-rs` is itself a native Node addon (`@yuuang/ffi-rs-*`). `bun build --compile` embeds a statically required `.node` file only for the host platform, so cross-compiled Linux builds would carry the wrong one. Binding `libfff_c` with `bun:ffi` avoids both problems; I recommend that.

`install` copies every file `companionFiles()` names from beside the source binary into `~/.polaris/bin/<version>/`, and the Client uploads them with the binary.

## Install (`polaris install`)

No sudo; everything under `~/.polaris/` (`POLARIS_HOME`). Each step is idempotent: a second run with the same binary changes nothing and restarts nothing.

1. Copy the binary (and native libraries) to `~/.polaris/bin/<version>/polaris`: write a temp file, then rename. It is skipped if the SHA-256 already matches. Renaming matters on macOS: overwriting a signed binary in place gets it killed.
2. Point `~/.polaris/bin/current` at `<version>` with an atomic symlink rename. The service always runs `~/.polaris/bin/current/polaris serve`.
3. Write the service file only if its content changed:
   - macOS: `~/Library/LaunchAgents/dev.lux.polaris.plist`, with `RunAtLoad` and `KeepAlive`, logs at `~/.polaris/logs/daemon.{out,err}.log`, and `POLARIS_HOME` and `PATH` set. It bootstraps into `gui/<uid>`. Over SSH to a Mac with nobody logged in at the console, that domain does not exist, so it falls back to `user/<uid>` and says so in `notes`.
   - Linux: `~/.config/systemd/user/polaris.service` (`$XDG_CONFIG_HOME` honoured), with `Restart=always`. Then `daemon-reload`, `enable` and `start` (or `restart` if the binary or unit changed while it was running), then `loginctl enable-linger $USER`. If polkit refuses linger (common over SSH), the report says `linger: "needs-admin"` and gives the exact `sudo loginctl enable-linger <user>` for an administrator to run. The Daemon still runs, but it stops at logout.
4. `polaris install --json` prints the report as one JSON line for the Client.

`polaris uninstall [--purge]` stops and removes the service and `~/.polaris/bin`, and keeps the event store and logs unless `--purge` is passed.

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

### Interface for the Harness workstream

A Harness that should survive an upgrade (the Codex app-server) is spawned with `const [ours, theirs] = socketPair(); Bun.spawn(argv, { stdio: [theirs, theirs, "inherit"] }); closeFd(theirs)`. Our end is then used through `connectFd(ours, …)`. `collect` reports `{ fds: { "harness:<sessionId>": ours }, children: { "harness:<sessionId>": pid } }`, and after the exec `takeHandoff()` returns them. A Harness whose protocol state lives in our process (the Claude Agent SDK) cannot be re-attached. Close it before the exec (the Agent Session goes Dormant) and resume it by cursor afterwards.

## Known gaps / TODO

- `daemon.pid` is written by `serveUpgrades`. Reconcile it with the transport's `daemon.lock` (one file could do both).
- Not yet in `polaris serve`: the transport owns `serve`, so the hand-off is wired only in the test fixture until then.
- Harness fds are named by convention (`harness:<sessionId>`); the Harness registry has to provide `collect`.
- `StandardOutput=append:` in the systemd unit cannot quote paths, so a `POLARIS_HOME` with spaces breaks logging on Linux.
- A Linux Host needs `systemctl --user` (a user bus). A minimal container or an SSH session without `pam_systemd` fails with a clear `InstallError`. There is no non-systemd fallback yet.
- The upgrade request is authenticated only by filesystem permissions (the files are mode 0600 under the user's home), which is enough for a per-user Daemon.
- Only macOS arm64 and Linux arm64 were exercised locally. linux-x64 is exercised by CI's smoke job.

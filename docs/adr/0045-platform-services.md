---
status: accepted
implements: the first four services ranked in docs/research/platform-seams.md; fixes B2, B8, B9 and folds in B4, B13
---

# Platform services: HostAccess, LocalHost, ChildProcess, HostPlatform

The platform audit (`docs/research/platform-seams.md`) found the same OS and
Host-kind questions answered in many places, each slightly differently:
feature code branching on `LOCAL_HOST_KEY`, `isWsl` and `requireRemote`; four
copies of "A local Windows Daemon is not supported."; seven `spawn` calls each
remembering (or not) `windowsHide`; the Daemon deciding its libc five times.
These four services give each question one answer, in the shape ADR 0044 set
for `SecureStorage`: one `Context.Service` API, a Layer per platform or Host
kind, and a test Layer that runs no real process, so each contract is tested
on every OS, Windows CI included.

## HostAccess (`@polaris/client/access`)

One command channel per `HostTarget`. `HostAccess.channel(target)` returns a
`HostChannel`: `kind`, `describe`, `home`, `trusted`, `exec` (a command on
the Host), `ssh` (the `Ssh` Layer the installer and upgrade plan run on) and
`interactiveArgv` (the argv a terminal runs to hand the user a shell there).

- `Local` with an installed home is the local installer (`Ssh.local`),
  trusted, with no interactive hand-off (`no-terminal`).
- `Local` without one is the app's own Daemon: `unmanaged-local`.
- `Local` on Windows is `local-unsupported`.
- `Ssh` and `Wsl` wrap the existing `Ssh` Layers and their argv.

Layers: `layer(options)` (the real runners), `fromRunners(runners)` (tests
that keep their own fakes), `test(script)` (scripted results, nothing run).
Refusals are `HostActionUnsupported` with a `reason`; the Desktop App turns
each into copy in one place (`machines/channels.ts`). Feature code in
`machines/` asks for a channel and never branches on the Host's kind; it
reads `channel.kind` only for activity copy.

Fixed: B2, a local Host with no installed home fell through to `ssh local`.

## LocalHost (`apps/desktop/src/main/local/`)

Whether this Client has a local Host and which Daemon serves it:
`supported`, `label`, `resolve` (the given socket, the dev Daemon, or the
installed system Daemon, resolved once), `current`, `listening(home)` and
`stop`. Layers: `posix(options)`, `unsupported()` (Windows: every call
refuses with `clientCopy().localHostUnsupported`, the one copy of that
sentence), `forPlatform(platform, options)`, and `test({ daemon })`. The
Desktop App's entry point builds it once; the Machines service, the Hosts
list and quit all read the same value.

## ChildProcess (`@polaris/client/process`)

Every child the Client starts goes through `ChildProcess.spawn(request)`:
the ssh and wsl transports, install commands, WSL discovery, the terminal
hand-off, Squirrel's `Update.exe`, the dev Daemon and its build. A child is
hidden unless the request says `visible` (only the terminal does), which
folds in B4. A child that never started is classified once by
`spawnFailed` (`missing`, `denied`, `failed`), which folds in B13, and
`stopChild` stops one with SIGTERM, then SIGKILL after a grace period.

The returned `Spawned` is the subset of Node's `ChildProcess` callers use,
so each site keeps its own event handling, timeouts and kill semantics.
Layers: `node` and `test(script)`, a scripted child with real streams and
Node's event order. Callers take a `ChildProcessApi` value rather than
requiring the service, because most of them are plain functions called
from outside an Effect runtime. `process/node` is the Effect-free half: the
Squirrel bootstrap imports it and must stay under 4 KiB.

## HostPlatform (`apps/daemon/src/platform/`)

The Daemon's os, arch and libc, detected once. `detectPlatform` is pure; a
compiled Linux build takes libc from its `POLARIS_LIBC` define, and from
source a glibc loader wins over musl's (ADR 0043's glibc-first rule, the one
the Client probe already used). `HostPlatform` is a `Context.Reference` that
defaults to the detected value, with `live` and `test(fixed)` Layers.

On the wire, `HostInfo` gains an optional `libc` (`glibc` | `musl`), sent
on Linux. `Platform` is not widened. New Clients decode an older Daemon's
`HostInfo` without it; older Clients ignore the extra key. Clients key a
Host's build with `buildPlatformOf(hostInfo)` (`linux-arm64-musl`).
The spec does not change: `hello`'s payload isn't modelled, and nothing about
how commands are decided, committed, streamed, resumed or recovered moves.

Fixed: B8, a glibc Host with musl's loader installed reported musl and
dlopened musl's loader; B9, a musl Host's bundled version was looked up
under the glibc build before any check ran.

## Left alone

The audit's services ranked 6 to 11 are out of scope here.

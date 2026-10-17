---
status: accepted
fixes: a Windows Daemon on Bun's own pipe could be read by any local account and reached over SMB
---

# The Windows Daemon listens on a user-only pipe

## Context

On macOS and Linux the Daemon listens on `~/.polaris/daemon.sock`, a Unix socket in a `0700`
directory, so only its user connects. A Windows Daemon (0.2.0, `windows-x64`) needs the same
property from a named pipe. Pipe names live in one machine-wide namespace (`\\.\pipe\…`), so
a directory's permissions protect nothing: each pipe carries its own security descriptor, and
a pipe can be opened from another machine as `\\host\pipe\…` over SMB unless it refuses.

Measured on Windows 11 with Bun 1.4.3 (libuv), `Bun.listen({ unix: "\\\\.\\pipe\\x" })`:

- **The DACL.** From a medium-integrity process: `O:<user>G:<user>D:(A;;FA;;;SY)(A;;FA;;;BA)
  (A;;FA;;;<user>)(A;;FR;;;WD)(A;;FR;;;AN)`. Everyone and Anonymous Logon may open it for
  reading, which is enough to connect. From an elevated process the user's own entry is gone
  (`O:BA`, only SYSTEM and Administrators get full access), so a later unelevated Client is
  turned away.
- **Remote clients.** `FilePipeLocalInformation` reports no `PIPE_REJECT_REMOTE_CLIENTS`, and
  `\\127.0.0.1\pipe\…`, `\\localhost\pipe\…` and `\\<hostname>\pipe\…` all connected from a
  credentialed interactive session: an SMB client is accepted.
- **Instances.** Unlimited, with no `FILE_FLAG_FIRST_PIPE_INSTANCE`, so another account can
  create the name first and wait for the Daemon's Clients.

## Decision

- **The Daemon creates its own pipe instances** with `CreateNamedPipeW` through `bun:ffi`
  (`apps/daemon/src/transport/windowsPipe/`), and hands each connected handle to
  `Bun.connect({ fd: handle })`, which on Windows wraps a pipe HANDLE as an ordinary Bun
  socket. The RPC transport above it is unchanged.
- **Only the user may open it.** Each instance gets `O:<user SID>D:P(A;;GA;;;<user SID>)`: a
  protected DACL with one entry. No Everyone, Anonymous, Administrators or SYSTEM. The owner is
  the user even when the Daemon runs elevated, so an unelevated Client still connects.
- **No other machine reaches it.** Every instance is created with `PIPE_REJECT_REMOTE_CLIENTS`.
  The DACL can't do this job: an SSH logon's token carries the NETWORK SID, so denying NETWORK
  would also refuse `polaris bridge` run over SSH on the same machine.
- **The Daemon claims the name or refuses to start.** The first instance uses
  `FILE_FLAG_FIRST_PIPE_INSTANCE`; if the name exists, `prepareSocketPath` probes it. A pipe
  this user owns is a running Daemon (`DaemonAlreadyRunning`); one another account owns is a
  squatter, and the Daemon refuses with a `LockError` rather than listen beside it.
- **Waiting costs no thread.** Each pending instance waits in an overlapped `ConnectNamedPipe`;
  `RegisterWaitForSingleObject` calls back into JavaScript (a threadsafe `JSCallback`) when a
  Client arrives. One instance is always pending; no timer, no polling, no Worker.
- **One endpoint function.** `@polaris/protocol/endpoint`'s `localEndpoint(home)` gives the
  Unix socket or `\\.\pipe\polaris-<sha256 of the lowercased home, 32 hex>`. The Daemon's
  `paths.socket`, the Desktop App's `systemSocket` and the dev Daemon all use it, so a
  `POLARIS_HOME` gets its own pipe and the name never reveals a user name.
- **Old Clients see an update, not a decode error.** `HostInfo.platform` is now any string on
  the wire (`HostPlatformName`); Clients from 0.2.0 announce `host.any-platform`. A Daemon on a
  platform outside `LEGACY_PLATFORMS` answers a Client without it with `PROTOCOL_VERSION + 1`
  and a placeholder platform, so the older Client reports "protocol mismatch, Client older"
  before it reads the Host (`helloHost`).

## Evidence

On the same machine, with the real Daemon (`polaris.exe serve --foreground`) on its pipe:

- Its descriptor reads back as `O:<user>G:<user>D:P(A;;FA;;;<user>)`, no label (medium).
- `\\127.0.0.1\pipe\…`, `\\localhost\pipe\…` and `\\<hostname>\pipe\…` give "Access to the path
  is denied" from the interactive session that connected to Bun's pipe above; the local name
  connects.
- Impersonating the anonymous token, opening the Daemon's pipe fails with `ACCESS_DENIED`, while
  the same open of a `Bun.listen` pipe succeeds (`windowsPipe/pipe.test.ts`, Windows only).
- A medium-integrity Client connects to a Daemon started elevated.

A second local account was not tested: creating one needs an administrator, and the anonymous
token stands in for "an account that isn't the user".

## Consequences

Clients must make the same check before trusting a pipe: the name is predictable, so a
squatter that wins the race before the Daemon starts could impersonate it to a Client. The
Daemon refuses to start in that case, but the Desktop App and `polaris bridge` don't yet compare
the pipe's owner with the user (a follow-up for S4 and S5, which needs a non-`bun:ffi` path in
Electron). Windows has no `execve` or `SIGUSR2`, so live upgrades are off there for now.

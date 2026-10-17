---
status: accepted
fixes: on Windows the Desktop App would speak the protocol to whatever owned the local Daemon's predictable pipe name, and had no local Host at all
---

# The Desktop App checks the local pipe's owner, and runs this PC's Daemon without a shell

## Context

ADR 0059 gives the Windows Daemon a user-only pipe whose name is predictable
(`\\.\pipe\polaris-<hash of the home>`). The Daemon refuses to start beside a pipe another
account created, but a Client that connects first and trusts the name could send its prompts,
files and approvals to a squatter. The Client must check the pipe's owner before it writes, and
check the handle it then uses: open, check, close and reopen lets the name change hands in
between.

The Desktop App's main process is Node (Electron), not Bun, so `bun:ffi` and Bun's
`connect({ fd })` aren't there. Measured on Windows 11 with Node 24.19 and Electron 44.4.5:

- `net.connect` to a pipe gives no handle to inspect.
- koffi 3.3.1 (MIT, prebuilt for win32-x64, no compiler at install) loads in both and can call
  `CreateFileW`, `GetSecurityInfo` and `ConvertSidToStringSidW`.
- libuv's `uv_open_osfhandle` is exported by `node.exe` and `electron.exe`
  (`koffi.load(process.execPath)`). It turns the checked HANDLE into an fd that
  `new net.Socket({ fd })` adopts as a pipe; reads and writes work.
- A pipe server sees the Client's token unless the Client limits impersonation:
  `SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION` lets it identify the Client, not act as it.
- Under Bun, koffi loads but Bun can't adopt the fd as a socket (the spike hung).

## Decision

- **Open, check, then adopt, on one handle** (`packages/client/src/windowsPipe/`). `CreateFileW`
  opens the pipe overlapped with identification-only SQOS; `GetSecurityInfo` reads the owner
  of that handle; a SID other than the user's (`TokenUser`) closes the handle and fails with
  the new Connection State reason `daemon-untrusted`, nothing written. A trusted handle goes
  through `uv_open_osfhandle` to a `net.Socket`. `ACCESS_DENIED` on open is also
  `daemon-untrusted`: our Daemon's DACL never refuses its own user.
- **The check is in `socketTransport`**, so every local-pipe connection made by a Node Client
  runs it. Under Bun (`process.versions.bun`) it is skipped: Bun Clients are only the
  Daemon's own tooling today, and closing that gap is a follow-up.
- **koffi, not a native addon or a helper.** An addon needs MSVC and node-gyp in every build
  and an Electron rebuild. A PowerShell or helper process per connection costs a spawn and
  checks a different handle (the TOCTOU above). A secret the Daemon proves it knows needs a
  protocol change and still lets a squatter read the first request. The packaged app carries
  koffi's JavaScript in the asar and `koffi.node` under `resources/koffi/win32_x64/`, where
  koffi looks in Electron.
- **This PC's Daemon is the bundled `polaris.exe`, run directly.** Windows x64 packages bundle
  the `windows-x64` build. Install is `<bundled>\polaris.exe install --json --sha256 <sha>`,
  an update is `<installed>\bin\current\polaris.exe upgrade <bundled> --json --sha256 <sha>`,
  and Start daemon re-runs the installed `install`, each a hidden child with `POLARIS_HOME`.
  The local `HostAccess` on Windows has no shell: its `exec` fails, so nothing reaches
  `/bin/sh` or PowerShell. Windows on Arm has no Daemon build and keeps no local Host.

## Evidence

On lucas-desktop (`ownedPipe.harness.ts`, run under Node by `ownedPipe.test.ts`):

- A pipe with `O:<user>D:P(A;;GA;;;<user>)` (the Daemon's descriptor) is trusted and echoes.
- A pipe with `O:BA` and the user's access entry is refused with `daemon-untrusted`, naming
  S-1-5-32-544, before any byte is written.
- A Node `net.Server` pipe created from an elevated session (owner BA) is refused the same way.
- No pipe gives `daemon-not-running`.

## Consequences

- `koffi` is a runtime dependency of `@polaris/client` and of the Desktop App; a Windows
  package without its win32-x64 build fails at packaging, not at the user's first connect.
- An administrator can still create a pipe owned by the user; that account can already read
  the user's files.
- A test install with `USERPROFILE` pointed elsewhere gets the plain Task Scheduler name
  (`dev.lux.polaris.<user>`), shared machine-wide with the real install.

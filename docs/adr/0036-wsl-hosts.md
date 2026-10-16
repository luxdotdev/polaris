---
status: accepted
implements: WSL 2 distros as Hosts (Windows, experimental)
---

# A WSL 2 distro is a Host reached through `wsl.exe`, not ssh

On Windows the Desktop App has no local Host (no native Daemon yet). A WSL 2
distro runs the unchanged Linux Daemon, so it becomes a Host kind of its own:
`HostTarget.Wsl({ distro })`, stored as a `RemoteHostSetting` with
`kind: "wsl"` whose `alias` is the distro name. Everything after the transport
(install flow, Connection States, feeds) is the ssh path.

## The command line

`wsl.exe --distribution <distro> --exec /bin/sh -c '<command>'`, with
`WSL_UTF8=1` in the environment. `--exec` bypasses the distro's login shell
(no profile, argv passed through untouched), and `sh -c` restores what ssh's
login shell gave us: `~` and `$HOME` expand inside the distro, as the distro's
default user. Plain `wsl.exe -- cmd` re-joins its arguments with spaces and
hands them to the login shell, whose quoting rules we cannot know.

The bridge is `--exec /bin/sh -c 'exec ~/.polaris/bin/current/polaris bridge'`
over `spawnTransport`, like `ssh <alias> polaris bridge`. Install commands run
through the same `Ssh` service (`wslInstallLayer`), so the probe, upload (a local
file streamed into stdin) and `polaris install --json` are the same scripts as
over ssh.

## Output encoding

`wsl.exe` writes its own messages (the distro list, "no distribution with the
supplied name") as UTF-16LE, on **stdout** with exit status -1; a Linux
program's stdio is relayed as raw bytes. So the bridge transport keeps the
start of stdout when it does not open a frame stream, and the classifiers read
it, but only on wsl.exe's own exit codes (-1, seen as 255 or 4294967295), so a
Linux command's own output never reads as a WSL failure.
`WSL_UTF8=1` makes WSL ≥ 0.64 write UTF-8, and older WSL ignores it, so every
read also sniffs: an even number of bytes with a NUL in most odd positions is
UTF-16LE. stderr is decoded chunk by chunk because both encodings can share
one pipe. The classifier strips stray NULs before matching, so a message read
the wrong way still classifies.

## Distros stop when nothing is attached

WSL terminates a distro once its last `wsl.exe` session ends (even with
systemd enabled; `instanceIdleTimeout` and `vmIdleTimeout` in `.wslconfig` only
stretch that), and the VM soon after. Polaris does not edit `.wslconfig`. The
Client's own bridge process is a session, so a distro Host stays up while the
Desktop App is connected to it; when the app quits, the distro and the Daemon
stop with it, and running Agent Sessions end as on a Host that rebooted. The
next connection brings the Daemon back: under systemd with linger at boot, or
through `polaris bridge` starting the fallback supervisor on demand. That
connection boots the distro, so the bridge runs before systemd has started the
Daemon (about 300 ms on WSL 2.7); with the systemd unit installed, the bridge
waits up to 5 s for the socket rather than reporting "no Daemon".

## Discovery and paths

`wsl.exe --list --verbose` lists distros; rows are parsed from the right (version,
state) so localized headers and state words still yield the name. WSL 1
distros are listed but refused (Bun needs a real kernel). Docker Desktop's
helper distros are hidden. Workspaces live in the distro's own file system;
`\\wsl.localhost\<distro>\…` is only for showing or revealing a path from
Windows.

## Verification

Tests run against the fake `wsl.exe` (`@polaris/client/wsl/testing`): it
answers `--list --verbose` in UTF-16LE or UTF-8, prints a missing distro's
message on stdout as real WSL does, and runs `--exec` argv locally with HOME at
a fake distro.

Verified on real WSL 2.7.11 (Windows 11 Pro x64, Ubuntu 26.04 with systemd,
plus a throwaway `ubuntu-base` 24.04 distro with and without systemd), driving
this package's own code from Node 24 and Bun 1.3.13 on Windows (steps in
`packages/client/README.md`, "Checking on real WSL"):

- `--list --verbose` is UTF-16LE without a BOM by default and UTF-8 under
  `WSL_UTF8=1`; docker-desktop distros are hidden, a WSL 1 distro reads as
  version 1, states parse.
- argv through `--exec /bin/sh -c`: quotes, backslashes (trailing too),
  `%PATH%`, `!^&|<>`, `$()`, tabs, newlines, an empty argument and non-ASCII
  all reach `sh` unchanged.
- stdin and stdout are binary-safe: a 156 MB upload matched its SHA-256 in the
  distro, and a 4 MiB blob of every byte value, CR LF, a BOM and ^Z round-tripped
  through `files.write` / `files.read` over the bridge.
- First install needs approval (`trusted: false`). Upload installed under
  systemd (linger enabled), HostFetch (curl, the published alpha.6 archive)
  under the fallback supervisor, and Upgrade (execve hand-off) under both.
- A stopped distro boots on connect (about 0.9 s to Connected under the fallback
  supervisor, 1.2 s under systemd). The bridge holds it up; it stops 13 to 15 s
  after the last `wsl.exe` session ends, with a systemd service and linger too.
- A missing or unregistered distro is `wsl-distro-missing` for the bridge and
  an `unreachable` `SshError` for install commands (before the stdout handling
  above, both read it as an ordinary failure).

Still unverified: the stub `wsl.exe` on a Windows without WSL (its message and
which stream it uses), "no installed distributions", localized Windows, and
`\\wsl.localhost` paths, which an OpenSSH session cannot open (only a desktop
logon can). The Desktop App's screens have not run against real WSL yet.

Sources: microsoft/WSL discussions #8659 and #9245, issue #10138 (idle
shutdown, `instanceIdleTimeout`); microsoft/vscode#276253 and podman#26527
(`WSL_UTF8`, UTF-16LE output); learn.microsoft.com/windows/wsl/wsl-config.

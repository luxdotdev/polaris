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
supplied name") as UTF-16LE; a Linux program's stdio is relayed as raw bytes.
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
through `polaris bridge` starting the fallback supervisor on demand.

## Discovery and paths

`wsl.exe --list --verbose` lists distros; rows are parsed from the right (version,
state) so localized headers and state words still yield the name. WSL 1
distros are listed but refused (Bun needs a real kernel). Docker Desktop's
helper distros are hidden. Workspaces live in the distro's own file system;
`\\wsl.localhost\<distro>\…` is only for showing or revealing a path from
Windows.

## Verification

Only the fake `wsl.exe` (`@polaris/client/wsl/testing`) has run any of this:
it answers `--list --verbose` in UTF-16LE or UTF-8 and runs `--exec` argv
locally with HOME at a fake distro. Real WSL behaviour (argv quoting through
`--exec`, binary-safe stdin, the exact stub messages, idle shutdown timing) is
unverified until the physical Windows machine is available; the checklist is in
`.dagr/reports/wwsl.md`.

Sources: microsoft/WSL discussions #8659 and #9245, issue #10138 (idle
shutdown, `instanceIdleTimeout`); microsoft/vscode#276253 and podman#26527
(`WSL_UTF8`, UTF-16LE output); learn.microsoft.com/windows/wsl/wsl-config.

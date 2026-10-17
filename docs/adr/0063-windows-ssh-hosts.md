---
status: accepted
fixes: a Windows PC couldn't be an SSH Host, and `polaris bridge` trusted whoever held the Daemon's pipe name
---

# Windows PCs are SSH Hosts through PowerShell, with stdin as base64 lines

## Context

The install flow (`packages/client/src/install/`) drives a Host over SSH with POSIX `sh`: a
`uname` probe, a file streamed on stdin into `cat`, `polaris install`, and `polaris bridge` as the
connection's remote command. A Windows OpenSSH server runs each command through its
DefaultShell: Windows PowerShell 5.1 by default, sometimes pwsh 7 or cmd.exe. `uname` doesn't
exist there, unless Git for Windows' `sh` is on PATH (as on our test PC), where it says MINGW.

Measured on Windows 11 (OpenSSH 9.5, DefaultShell `powershell.exe` 5.1) from macOS:

- **PowerShell takes the channel's stdin.** For `powershell -c "<cmd>"`, the PowerShell host
  reads stdin itself (to feed `$input`) and a child process sees only part of it: a native reader
  stalled after exactly 167936 bytes, nested or not, paced or not, and a raw `bun` cat lost its
  tail. Binary bytes can't reach a child intact.
- **Piping `$input` into a native exe** buffers everything until stdin closes, so it can't carry
  a conversation.
- **sshd closes the channel when the shell exits**, so a background `Start-Process` can't
  outlive it to own the pipe.
- **A nested PowerShell writes CLIXML on stderr** (`#< CLIXML`, progress records, and errors as
  `<S S="Error">` with `_x000D__x000A_` escapes) unless told otherwise.
- **Lines are limited**: cmd.exe refuses one over 8191 characters, CreateProcess one over 32767.
  sshd hands the line to `-c` inside double quotes, so a `"` in it breaks the command.

## Decision

- **Detection.** The POSIX probe runs first, unchanged. If it fails, or `uname` says MINGW, MSYS
  or Cygwin, the Windows probe runs: one `powershell -NoProfile -NonInteractive -EncodedCommand`
  line (base64 UTF-16LE, so valid in every DefaultShell). It prints the OS, the architecture, the
  installed Daemon and the DefaultShell (the PowerShell's parent process name). `windows` with
  `AMD64` is `windows-x64`. A DefaultShell other than PowerShell, pwsh or cmd plans as
  Unsupported and names it. A POSIX Host's probe is byte for byte what it was.
- **Stdin travels as base64 lines.** Every Windows command that takes stdin is
  `$input | & ([ScriptBlock]::Create(<decoded script>))`, whose `process` block decodes one line
  (48 KiB of bytes) per `$_`. PowerShell reading stdin is then the transport, not the problem. The
  Client encodes (`Ssh` `stdinLines`, `spawnTransport` `stdinLines`); under cmd the same lines are
  read by `[Console]::In.ReadLine()` in an `-EncodedCommand`. Measured: byte-exact, about 11 MB/s
  and 5 ms a round trip; a 141 MB build uploads in about 9 s.
- **Install, upgrade and uninstall** are the POSIX steps in PowerShell: a staging directory under
  `%USERPROFILE%\.polaris` created with a protected DACL for the user only (refused if it exists or
  is a reparse point), the upload written with `CreateNew` and checked with `Get-FileHash`, then
  `polaris.exe install` / `upgrade` with the SHA-256, and the directory removed. The Host doesn't
  download builds itself yet: the Client fetches them (`ClientFetch`).
- **The bridge runs behind a relay.** The connection's remote command is a PowerShell relay that
  starts `polaris.exe bridge --relay <its PID>` with only stdin redirected: it decodes lines into
  the bridge's stdin, while the bridge's stdout and stderr are the channel's, raw. When the
  bridge ends it terminates the relay with its own exit code, which closes the channel (the
  relay would otherwise wait on stdin forever: the Client sends no pings).
- **Stderr is read through `stripClixml`** before any failure is classified, and every script
  sets `$ProgressPreference = 'SilentlyContinue'` and turns a thrown error into one
  `polaris: <message>` line and exit 1.
- **`polaris bridge` checks the pipe's owner on the handle it uses.** On Windows it opens the
  pipe with `CreateFileW`, reads the owner SID from that handle, and adopts the same handle with
  `Bun.connect({ fd })` only when the owner is the current user; there is no second open to race.
  Another owner, or `ACCESS_DENIED`, is refused before a byte is sent, with exit 77
  (`BRIDGE_EXIT_UNTRUSTED_DAEMON`) and "another account holds the Daemon's pipe name", which
  Clients classify as `daemon-untrusted`, a needs-attention reason the Connection State machine
  doesn't retry. The Daemon's own CLIs (`constellation stats`, `lease`) connect the same way
  (`transport/localDaemon.ts`).

## Evidence

From the Mac against `lucas-desktop` with the real `packages/client` code
(`apps/daemon/scripts/e2e-windows-ssh.ts`): probe, install, connect over `polaris bridge` (hello
says `windows-x64`), register a Workspace, a terminal echoes, upgrade to a second build, reconnect
(epoch 2, `previousStop: upgrade`), the terminal echoes again, and uninstall: 37 s in all.

The owner check: from an elevated process, a `Bun.listen` pipe is owned by Administrators
(`S-1-5-32-544`), so it stands in for another account. The installed `polaris.exe bridge`, run
locally and over SSH through the relay, exited 77 against it; the squatter saw one connection
and zero bytes (`windowsPipe/client.test.ts`, elevated only). An unelevated process can't create a
pipe another SID owns, and no second local account was available, so a squatter that is a
different ordinary user was not tested.

## Consequences

- The Desktop App must keep the probe's `windowsShell` on the Host (`HostTarget.Ssh`); a
  configured remote command is ignored for a Windows Host.
- cmd.exe and pwsh as DefaultShell were tested by running the commands as sshd does, not
  through an sshd configured with them.
- Detection costs a Windows Host a second round trip (about 2 s); a POSIX Host pays it only when
  its probe has already failed.

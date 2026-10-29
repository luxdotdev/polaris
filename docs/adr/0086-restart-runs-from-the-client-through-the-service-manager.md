---
status: accepted
fixes: Settings → Hosts' "Restart daemon…" (ENG-564, HS-D4) had nothing to call (ENG-568)
---

# Restart runs from the Client through the Host's service manager

## Context

Settings → Hosts offers "Restart daemon…" (DESIGN.md, "Settings → Hosts redesign"). The Daemon
runs under a user service: launchd on macOS, `systemd --user` on Linux, Polaris' own supervisor
on a Linux Host without a user bus, the per-user logon task on Windows (ADR 0060). A Daemon can't
reliably restart itself: under launchd a job that asks to be killed and started again races its
own exit, and a Daemon that doesn't answer can't be asked at all.

## Decision

- **The Client restarts the service**, over the channel it already uses to reach the Host
  (`HostAccess`: ssh, `wsl.exe`, a local `sh` for this Mac's installed Daemon; this PC's
  `polaris.exe` on a Windows Client). `@polaris/client/restart`'s `restartDaemon` probes which
  service holds the Daemon in one `sh` round trip, then runs that manager's own restart:
  `launchctl kickstart -k <gui|user>/<uid>/dev.lux.polaris`, `systemctl --user restart
  polaris.service`, or for the supervisor a `kill` of `daemon.pid` (the supervisor starts it
  again; with none running, it waits for the lock and starts one). The names live in
  `@polaris/protocol/endpoint`, shared with `polaris install`.
- **Windows goes through `polaris.exe install --restart`.** The Daemon stops only on its control
  pipe, which only the binary speaks (ADR 0060); `--restart` stops it with reason `restart`,
  then `schtasks /Run` starts the task. A task another Polaris home owns is `TaskConflict`, as
  for an install.
- **Claude's Turns end cleanly first.** The Client calls `host.prepareRestart` (capability
  `host.restart`), which runs the upgrade path's `prepareForUpgrade`: in-process Harnesses stop
  and their sessions recover with cause `upgrade`. A Daemon without the RPC, or one that doesn't
  answer, is restarted anyway; the next Daemon's recovery (cause `restart`, ADR 0004) ends the
  Turns. `host.restartPreview` answers the confirm's counts: sessions with a Turn in flight,
  running terminals, pending approvals.
- **Only while connected, except this machine.** A remote Host that isn't Connected is refused
  (`RestartRefused`, "Restarts once Mac Studio is connected"); this Mac's own Daemon restarts
  even when it doesn't answer.
- **The Connection State machine is unchanged.** The restart drops the connection, which the
  machine already reads as Reconnecting (an immediate retry, and "no Daemon" counts as a restart
  for `restartGraceMs`). While a Host waits on Needs Attention or Offline, the restart sends
  `retry` every second. It is back when the Host is Connected with a new `HostInfo.startedAt`;
  otherwise it fails after 60 s with "Reinstall service".
- **Failures carry the manager's own words**: `RestartFailed` has the exact command (for "Copy
  command"), the manager's stderr, its exit code, and whether "Reinstall service" applies.

## Consequences

- The spec doesn't change: `crash` / `restart` already stand for the Daemon dying at any point
  and starting on the same database, and `prepareForUpgrade` is the unmodelled upgrade hand-off
  whose recovery is a subset of the one on start.
- A setup card interrupted by the prepare step says "upgrade", as before an upgrade.
- Recovery of In Terminal sessions waits for the restart's own recovery (cause `restart`), as
  `upgrade` leaves them alone.

---
status: accepted
implements: a fresh 0.1.0-alpha.1 install whose local Daemon never started (tester report, 2026-10-13)
---

# The app installs this Mac's Daemon from its own build

Until now the local Host only ever upgraded: installing a Daemon on this Mac
was "the user's own step". That held while every Mac running Polaris was a
developer's with a Daemon installed by hand, and failed the first time a
tester installed a release. The packaged app connected to
`~/.polaris/daemon.sock`, found nothing, showed "The daemon on This Mac isn't
running", and its Start daemon sent the local Host's key down the remote path
("no remote host \"local\""). There was no way to get a Daemon short of a
shell and a binary from inside the app bundle.

## Decision

- When the local Host is the installed system Daemon (`LocalDaemon.installedHome`,
  never the app's dev Daemon or a given socket) and nothing is installed there,
  the socket transport reports `polaris-not-installed` and the app installs the
  `darwin-*` build it carries: `polaris install` through `Ssh.local(home)`,
  the same planner, copy and SHA-256 check as a remote Host.
- No approval card. The approval exists because a remote machine is someone
  else's; this build ships inside the app the user just chose to run, on the
  user's own Mac. `PlanOptions.trusted` and the install flow's `trusted`
  planned event carry that, and only the local Host sets them.
- It happens on the first background check (the app's first launch), and on
  Install or Start daemon in the row.
- After installing or starting, the app waits for the socket (launchd takes a
  second or two) and, if it never opens, says why from the Daemon's own
  `~/.polaris/logs/daemon.err.log`. The row's detail does the same whenever the
  installed Daemon isn't listening.

## Consequences

Remote Hosts still ask before a first install. A Mac with nothing installed
and a dev build of the app still uses the app's own dev Daemon (ADR 0007).

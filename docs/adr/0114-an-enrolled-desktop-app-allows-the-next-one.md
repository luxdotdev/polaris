---
status: accepted (ENG-927)
---

# An enrolled Desktop App allows the next one

Supersedes ADR 0110. ADR 0100's reasons for the gate, its table of what is gated, and "What this
does not stop" still hold.

## Context

ADR 0100 (ENG-700) gated user-only requests behind a Desktop App's user key, and enrolled only the
first key a Host saw, so a second Desktop App was locked out. ADR 0110 (ENG-926) turned the gate
off for 0.9.2, which reopened ENG-700's hole: any process that reaches the Daemon socket, an
agent's shell included, could approve its own Pending Approvals, send Turns and start sessions.

## Decision

- **The gate is on again.** A token-less connection makes the requests `USER_RPCS` and
  `USER_COMMANDS` mark `user` only while the user key its `hello` presented is enrolled. `hello`
  answers `userAccess` accordingly. Extensions keep their Grants and Linked Devices their
  allowlist; neither passes through this gate.
- **A registry of the user's own Desktop Apps.** `~/.polaris/user-access.json` (0600, version 2)
  holds a digest, bound to the `hostId`, of each enrolled key, with the device label and when it
  was enrolled. The Host never holds a key. The registry is local: it never depends on a Polaris
  Account, and a Teammate of a Shared Session is a relay peer scoped to a Share (ADR 0112), never an
  entry here.
- **Trust on first use, once.** A Host with no enrolment file enrols the first key it sees. A
  file that is there with no key in it is not a fresh Host: it enrols nobody and opens no request.
- **Then an enrolled Desktop App allows the next.** An unknown key opens a request. Every Desktop
  App that holds user access on the Host is asked "Allow ‹device› on ‹host›?", and
  `userAccess.allow` enrols the key. Its open connections hold user access from that request on,
  without reconnecting. `userAccess.deny` closes the request; that Desktop App asks again when it
  reconnects. A request lives only while a connection that presented the key is open, and a Host
  keeps at most 8.
- **The code.** A request carries six characters of the key's digest ("4F2-91C"). The asking
  Desktop App shows it and so does the prompt, because the label is whatever the asker sent: a
  process on the Host can open a request named after the user's laptop, but can't know the code
  that laptop is showing.
- **Listing and revoking.** `userAccess.watch` gives a connection its standing (`held`, `waiting`,
  `none`), and, only while it holds user access, the enrolled Desktop Apps and open requests.
  `userAccess.revoke` removes a key: its open connections lose user access with that request,
  since the gate checks the enrolled set on every request, and the user-only requests and
  streams they already have open end, refused, at the same moment (a preview of a window an
  agent drives stops). A Desktop App may revoke itself, but never the last one: the Host refuses
  with `LastEnrolledApp`, because an empty registry could allow nobody and must not go back to
  first use. The Desktop App shows all this under Settings → Hosts, on the host's page.
- **What runs a program or writes the Host's files is user-only.** Without it a socket-only
  process deleted the enrolment file through `files.delete` and won first use, or ran a command
  through `terminal.open`. So `user` also covers: `files.write`, `create`, `delete` and
  `rename`; `terminal.open`; `git.stage`, `unstage`, `discard`, `commit`, `init` and `sync`
  (hooks and credential helpers run); installing language tools, choosing the Python
  interpreter, formatting, and applying or recovering language edits; the managed prediction
  server; trace settings (what spawns are instrumented with, where traces are forwarded); the
  Reviewer's Harness; a Constellation's dispatch, worker start and prepare, and git transfers;
  and the Commands `SetWorktreeSetup`, `ForkSession`, `SetModel` and the review checkouts.
  Extensions and Linked Devices were already refused all of these by their own tables. Reads,
  `host.resources.*` (`polaris lease`), `constellation.stats` and `extensions.list` stay open
  to the Daemon's own CLIs.
- **`allow`, `deny` and `revoke` are user-only**, so a waiting key can't allow itself.
- **The CLI.** `polaris extension pair` and `revoke` are for the Desktop App again, as in ADR 0100.
- **0.9.0's file is not kept.** A version 1 `user-access.json` held the one key 0.9.0 or 0.9.1
  enrolled, and nothing has checked it since 0.9.2. Reading it could lock a Host to a Desktop App
  the user no longer has, so the first Desktop App to connect after the upgrade is enrolled
  instead. A file that can't be read or parsed enrols nobody and opens no request.
- The capability `user-access.enrolment` tells a Desktop App the Host serves `userAccess.*`.

## Recovery

When no enrolled Desktop App is left to allow a new one (the last one is lost, since it can't be
revoked), the person at the Host deletes `~/.polaris/user-access.json` there: the next Desktop
App to connect is enrolled. The Daemon reads the file on the next `hello`, allow or revoke.

## Consequences

ENG-700's protection is back, with the limits ADR 0100 lists: a process running as the user with
a shell of its own can still delete the file and enrol itself, which the user sees as their
Desktop App losing user access. The Daemon no longer does that for a process that has only its
socket. Scripts that drive a Daemon without a user key lose the requests listed above. Trust on first use leaves the same window as before on a Host no Desktop App has
connected to, and once more on each Host at the upgrade from 0.9.x.

A prompt can be spoofed in its label, not in its code; a user who allows without comparing the
code can still be fooled. A Host reached by one Desktop App only never shows any of this.

## Considered

- **Enrol every key that connects.** Rejected: any process could enrol itself.
- **Keep 0.9.0's enrolment.** Rejected for the lockout above.
- **Approve from the Host's terminal** (`polaris user-access allow`). Rejected: an agent's shell
  runs the same command.
- **Polaris Accounts decide which devices are the user's.** Rejected (ADR 0112): a user's access
  to their own Hosts stays local, and an Account Server must never be able to grant it.

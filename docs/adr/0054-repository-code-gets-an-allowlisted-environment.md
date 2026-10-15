---
status: accepted
fixes: Review Run handed the Daemon's whole environment to a pull request's code (security audit, 2026-10-15)
---

# Repository code gets an allowlisted environment

## Context

Run in a Review Checkout starts the pull request's own `dev` or `start`
script in a Daemon terminal. Terminals passed `childEnv(process.env)`, which
removes only `POLARIS_HANDOFF`, so the script could read whatever the
Daemon's environment held: provider keys, `GITHUB_TOKEN`, `SSH_AUTH_SOCK`,
`POLARIS_*`. A Daemon started by launchd or systemd has a narrow
environment, but a foreground or development Daemon (the Desktop App's dev
Daemon copies its own environment) can hold anything. ADR 0001 says Polaris
never touches provider credentials; handing them to untrusted code breaks that.

## What we do

- `service/childEnv.ts` has `repositoryEnv`: an allowlist (PATH, HOME, USER,
  LOGNAME, SHELL, LANG, `LC_*`, TZ, the temp dirs, TERM, COLORTERM, and what
  Windows needs to start a process). Anything that runs a repository's code
  on its own behalf uses it.
- `terminal.open` decides on the Daemon, not the Client: a terminal whose cwd
  is inside any recorded Review Checkout (compared by real path) starts with
  `repositoryEnv`. That covers Review Run and a shell the user opens there,
  and no Client can opt out.
- Other terminals keep the user's environment: they are the user's shell.

## Limits

Run goes through the user's login shell (`$SHELL -lc`), so whatever the
user's own profile exports is set again. That is the user's choice, not the
Daemon's leak. Harness children keep `childEnv`: each Harness owns its sign-in.

# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, in either of two ways:

- **GitHub:** use [the private advisory form](https://github.com/luxdotdev/polaris/security/advisories/new) (or the repository's [Security tab](https://github.com/luxdotdev/polaris/security), then **Report a vulnerability**).
- **Email:** write to [security@lux.dev](mailto:security@lux.dev).

Don't open a public issue, pull request or discussion for a vulnerability.

Include what you can of:

- the component (the desktop app, the daemon, the site or the update feed) and the version or commit;
- the platform, and whether the affected host is local, remote over SSH, or WSL;
- steps to reproduce, or a proof of concept;
- what an attacker gains, and what they need first.

We'll acknowledge your report, keep you updated while we work on a fix, and credit you in the advisory unless you'd rather we didn't. Please give us a reasonable time to release a fix before you disclose anything publicly.

## Supported versions

Fixes go into the latest release. Polaris is early: older releases don't get backported fixes, and the desktop app updates itself to the latest one.

## Scope

In scope:

- **The daemon** (`apps/daemon`): its local socket and the SSH and WSL bridges, the event store, agent drivers and approvals, files, git, worktrees and review checkouts, terminals, language servers and trust, and installing and upgrading the daemon, including verification of the binaries it installs.
- **The desktop app** (`apps/desktop`): its IPC bridge, the GitHub accounts and tokens it holds, updates, and anything that lets a workspace's contents, a pull request or an agent's output run code or reach data it shouldn't.
- **The site and update feed** (`apps/site`): the download and update routes and the download email.
- **Release integrity**: signing, notarisation and the published assets.

Out of scope:

- vulnerabilities in the agents Polaris drives (Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI), in a model server you run for tab completion, or in other third-party software; report those to their maintainers;
- what an agent does with the permissions you grant it;
- attacks that need an already compromised host, user account or SSH key;
- the fact that the experimental Windows build is unsigned.

Polaris never holds an agent's provider credentials ([ADR 0001](docs/adr/0001-polaris-never-touches-provider-credentials.md)); a way to make it read or send them is in scope.

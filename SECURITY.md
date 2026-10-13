# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's [Security tab](https://github.com/luxdotdev/polaris/security) and choose **Report a vulnerability**, or go straight to [the advisory form](https://github.com/luxdotdev/polaris/security/advisories/new). Don't open a public issue, pull request or discussion for a vulnerability.

Include what you can of:

- the component (Desktop App, Daemon, the site or update feed) and the version or commit;
- the platform, and whether the affected Host is local, remote over SSH, or WSL;
- steps to reproduce, or a proof of concept;
- what an attacker gains, and what they need first.

We'll acknowledge your report, keep you updated while we work on a fix, and credit you in the advisory unless you'd rather we didn't. Please give us a reasonable time to release a fix before you disclose anything publicly.

## Supported versions

Fixes go into the latest Release. Polaris is early: older Releases don't get backported fixes, and the Desktop App updates itself to the latest one.

## Scope

In scope:

- **The Daemon** (`apps/daemon`): its local socket and the SSH and WSL bridges, the event store, Harness drivers and approvals, files, git, Worktrees and Review Checkouts, terminals, language servers and Trust, and install and Daemon Upgrade, including verification of the binaries it installs.
- **The Desktop App** (`apps/desktop`): its IPC bridge, the GitHub accounts and tokens it holds, Updates, and anything that lets a Workspace's content, a pull request or Harness output run code or reach data it shouldn't.
- **The site and update feed** (`apps/site`): the download and update routes and the download email.
- **Release integrity**: signing, notarisation and the published assets.

Out of scope:

- vulnerabilities in the Harnesses Polaris drives (Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI), in a model server you run for tab completion, or in other third-party software; report those to their maintainers;
- what an agent does with the permissions you grant it in a Harness;
- attacks that need an already compromised Host, user account or SSH key;
- the experimental, unsigned Windows build being unsigned.

Polaris never holds a Harness's provider credentials ([ADR 0001](docs/adr/0001-polaris-never-touches-provider-credentials.md)); a way to make it read or send them is in scope.

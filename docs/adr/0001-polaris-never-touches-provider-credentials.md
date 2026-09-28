# Polaris never touches provider credentials

Polaris never reads, stores, refreshes or reuses a model provider's credentials: no API keys, no OAuth tokens from a Harness's config or the Keychain, no browser cookies. Each Harness owns its own sign-in, done in the Harness's own terminal UI, and Polaris only learns what the Harness exposes through its programmatic surface or writes to its own logs. Some providers forbid third-party use of subscription credentials, and we will not put our users' accounts at risk of a ban.

## Considered Options

- **Store keys in Polaris and inject them per Agent Session.** Rejected: it makes the Daemon a secret store, and subscription logins cannot be moved this way without breaking provider terms.
- **Read a Harness's stored OAuth token to call provider endpoints directly** (as CodexBar does for Claude and Codex Plan Limits). Rejected for the same reason, even though it is the easiest way to get Plan Limits while no Agent Session is running.

## Consequences

- Plan Limits come only from the Harness: the Claude Agent SDK's rate-limit events and usage call, and the Codex app-server's rate-limit methods. When no session for that Harness is running, Clients show the last known value and how old it is. OpenCode reports a limit only when a request is refused.
- Usage is read from the logs each Harness writes on the Host, never from provider billing APIs.
- A Harness that is not signed in is shown as not ready on that Host, with a way to sign in through the Harness's own terminal.

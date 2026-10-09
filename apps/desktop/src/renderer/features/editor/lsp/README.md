# Editor language contexts

The coordinator owns one ordered session per authenticated connection, checkout,
project and provider configuration. Closing a preview sends `didClose` but retains
that session so the next file sends `didOpen` on the same context. The Daemon owns
process idle grace; the coordinator releases interests when disposed, on connection
replacement, or when its 128-context bound reclaims an unused session.

Settings and discovery observations share pending reads. Keys include the independently
authenticated Client and connection epoch, checkout, language and effective Settings.
Discovery also retains directory boundaries so opening an unfamiliar nested project
can select its own root, SDK and plugins. Replaced/Invalidated context events, Trust
revision changes and Settings refresh invalidate observations; an old pending result
cannot populate a new observation lifetime. Blocked discovery is never retained.

A newly acknowledged document notifies every attached buffer, making its provider
ready and scheduling diagnostic pulls. Document and feature acknowledgments continue
to fence versions and generations. Cached preflight never substitutes for Daemon
Trust or checkout authorization.

`reuse.test.ts` covers preview replacement, diagnostic delivery, configuration and
Trust replacements, an executable override, nested directory discovery and reconnect.
`observations.test.ts` covers shared pending reads, isolation and invalidation races.
Main's language bridge retains one authenticated registration feed and folds actual
Workspace, Worktree and Review Checkout events before authorizing each operation.

A typed stale-generation failure between acquisition and watch reacquires retained
buffers, with three consecutive retries before becoming unavailable (ADR 0027).
An owned Snapshot resets that bound; authorization failures never retry.

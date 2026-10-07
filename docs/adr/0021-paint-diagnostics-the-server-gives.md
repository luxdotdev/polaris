---
status: accepted
amends: M3.1 E0's diagnostic freshness rule (docs/reports/m31/E0.md)
---

# Paint the diagnostics the server gives

M3.1 E0 kept unversioned diagnostics out of the editor's decorations, so that a set
published for older text could never mark the current buffer. In practice
typescript-language-server publishes without a version, so the bundled TypeScript
never drew an error, and TypeScript 7's native server publishes nothing unless asked.

The renderer now does two things. An unversioned push is painted only for the buffer
version its provider had acknowledged when the push arrived, and it is dropped as soon
as the buffer changes. A late push from older text can still show for one round, until
the next push replaces it; editors that follow LSP accept the same risk.
Last-known data still never paints as current. For providers that offer pull
diagnostics, the renderer pulls the open buffer each time its providers acknowledge a
new version, debounced by 150 ms. The result is versioned to the text it was asked
for, so it paints like any versioned set. Pulls ask for full reports and never chain
result IDs.

The Daemon is unchanged: it already labels freshness and emits pull results.

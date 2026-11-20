---
status: accepted (ENG-1020)
---

# Settings split into Host Settings and Client Settings

## Context

Agents run on the Daemon, but appearance, Hosts and the Harness and Model new sessions
start with lived in the Desktop App's `settings.json`, out of their reach; the Daemon kept
five JSON files of its own. Moving everything to the Daemon would make theme and density
follow a Host rather than a device; syncing every setting across Hosts needs a store no
Host owns.

## Decision

**Host Settings** are kept by the Daemon and apply to the work on that Host; the Desktop
App's `sessionDefaults` move there. **Client Settings** (theme, density, fonts, keybinding
overrides) stay on each device. An agent's change to a Client Setting is relayed by the
Daemon to the Client showing its session, else the one used most recently, which applies it
with a toast and Undo; with no Client connected it fails, and nothing is queued. Every
setting carries a description, type and default in its Schema, so agents can list and
describe them.

## Consequences

- Two Desktop Apps keep different appearance, as before.
- A Client Setting can't be changed while no Client is connected.

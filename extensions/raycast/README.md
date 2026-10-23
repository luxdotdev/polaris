# Polaris for Raycast

Supervise your Polaris agent sessions from Raycast: see what needs you, approve or deny,
send turns, interrupt, and start agent sessions on any paired host. It is an Extension on
[`@polaris/sdk`](../../packages/sdk), so it can do only what its pairings allow.

## Pair it

In Polaris, open Settings → Extensions, pair Raycast with what it may do, and copy the
pairing string (`polaris-pair:v1:…`). In Raycast, run **Hosts** → Add Pairing and paste it.
Add one pairing per host; a host reached two ways (the Daemon's socket and its gateway) can
have both, tried in that order. Pairings are kept in Raycast's LocalStorage for this
extension. Removing one in Raycast doesn't revoke it: revoke it in Polaris.

## Commands

| Command | |
|---|---|
| Search Agent Sessions | Sections Needs You, Working, Idle; Archived while you search. Accessories: session state, workspace, host, last turn. A host dropdown when more than one is paired. |
| Pending Approvals | Every approval waiting on you, oldest first, with what the agent wants to run. |
| Search Workspaces | New Agent Session ↵, Open in Polaris ⌘O, Show in Finder (hosts on this Mac), Copy Path ⌘⇧. |
| New Agent Session | Workspace, Harness, first turn (prefilled from the command's argument), permission mode, worktree branch. |
| Hosts | Each pairing with its Connection State: Connected, Reconnecting, Needs attention (revoked, version mismatch) or Offline. |

On an agent session: Open in Polaris ↵ (`polaris://session/<hostId>/<sessionId>`), Send Turn ⌘T,
Approve ⌘⇧A (Answer, for a question), Deny ⌘⇧D, Interrupt ⌘., Show Details ⌘D, Pin ⌘⇧P,
Copy Session ID ⌘⇧C. Pins stay in Raycast.

When no paired host can be reached, or its Polaris speaks another protocol version, a
command shows why instead of its list. A refusal names the Grant the pairing lacks
(“This pairing can't send turns”, pair again with “Send turns” on).

## Develop

The extension is a root workspace, so it resolves `@polaris/sdk` from source.

```sh
bun run --cwd extensions/raycast dev        # ray develop: load it into Raycast
bun run --cwd extensions/raycast ray:build  # ray build: bundle and type-check as Raycast does
bun run --cwd extensions/raycast test       # the models, and against a real Daemon
```

`src/lib/` is the model (sections, approvals, pairings, Connection State, copy) and has no
Raycast imports, so it runs under `bun test`; `src/lib/daemon.test.ts` drives it through the
SDK against `polaris serve` from source. Publishing to the Raycast Store waits for the SDK
on npm (ENG-420).

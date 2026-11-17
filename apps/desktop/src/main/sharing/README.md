# Sharing (main process)

Shared Sessions in the Desktop App (ENG-941, ADR 0112), on `@polaris/client`'s `Accounts` and the
`HostDirectory`. The renderer reaches it through `sharing.*` (`src/shared/sharingContract.ts`);
session tokens and Host capabilities never cross the bridge.

| File | What |
|---|---|
| `index.ts` | `DesktopSharing`: composes the two sides, keeps the "Shared with you" view, asks signed-in Accounts for Invites at launch, on sign-in, every 2 minutes and on request. |
| `owner.ts` | Share: the invitee's person from `GET /v1/people`, the Host's relay route (turned on if off), `POST /v1/invites`, then `shares.create` with the Invite and its Host capability, withdrawing the Invite if the Host refuses. List, renew, revoke, presence. |
| `teammate.ts` | Accept an Invite with this device's relay keys, keep it (`store.ts`) and add the owner's Host as a relay Host whose connections present the Account's statement in `hello`. |
| `teammateFeed.ts` | A Teammate can't call `subscribeHost`: that Host's `host` feed is built from the shared sessions' streams, renumbered so its sequence only rises. |
| `views.ts` | Shares, their logs and presence as the renderer shows them. |
| `store.ts` | `<userData>/sharing/shared.json`: what was accepted (nothing secret). |

A Teammate's Hosts are in the `hosts` feed with `shared: true`; the renderer keeps them out of
your machines. An Invite's relay URL (`relayUrl`, ENG-941 B2) is dialled when present, else
`POLARIS_DESKTOP_RELAY_URL` (tests) or Polaris Cloud.

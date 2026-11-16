# Shares

A Share gives one person time-limited access to one Agent Session or Constellation on this
Host (CONTEXT.md: Sharing). The Account Server vouches for who a device belongs to; the Host
decides what that person may do ([ADR 0112](../../../../docs/adr/0112-accounts-vouch-for-people-hosts-decide-access.md)).
The contract with the Account Server is `apps/accounts/README.md`; the wire contract is
`packages/protocol/src/shares.ts` and `shareGrants.ts`.

| File | What |
|---|---|
| `store.ts` | `shares.sqlite`: each Share, its Invite, the share log, the devices admitted. |
| `statement.ts` | Verifies a statement (an EdDSA JWT) against the pinned issuer's JWKS. |
| `issuer.ts` | The devices long-poll and the capability's revocation. |
| `body.ts` | An issuer's answer, read up to a byte limit and only from its own origin. |
| `identities.ts` | Co-author trailers' names and commit emails, from the Shares (`../coAuthors/`). |
| `devices.ts` | One poll per live Share; the devices with a statement the Host verified. |
| `service.ts` | `Shares`: create, renew, revoke, list; the Relay route's guests; the one timer. |
| `gate.ts` | The Share gate in front of every RPC on a Teammate's connection. |
| `targets.ts` | What a session touches, from the event store's model. |
| `presence.ts` | Who has a shared target open. |
| `rpc.ts` | `shares.*` and `account.refreshStatement`. |

## Lifecycle

1. The owner's Client makes an Invite on the Account Server and calls `shares.create` with the
   target, the invitee's `personId`, the issuer, the Invite's ID and the host capability. The
   Host asks the issuer once (a wrong capability is `invite`, no answer `issuer-unreachable`),
   stores the Share with the person pinned, and keeps the capability in `HostSecrets`.
2. While the Share is live, one long-poll per Share asks its issuer for the devices that
   accepted the Invite (`GET /v1/shares/{inviteId}/devices`, with the ETag). Each device comes
   with a statement; the Host keeps the device only if the statement verifies against that
   issuer's JWKS, names the Share's person and that device's Noise key, and has not expired.
   The first one fills in the person's login, name, avatar and commit email, logged `Accepted`.
3. The devices it kept are the Relay route's guests: listed as relay `peers`, and a Noise
   handshake is answered only for a kept key from the address the issuer listed it at. Any
   other handshake gets no reply. The first session of a device is logged `DeviceAdded`.
4. The connection acts as a Teammate. The Share gate scopes every request (below). `hello`
   answers the person's live Shares, and may present a statement; `account.refreshStatement`
   presents a newer one.
5. The connection ends, and the device is refused, when the Share is revoked (before
   `shares.revoke` answers), when it expires, when the device's statement lapses with no
   newer one from the poll or the device, or when the issuer no longer lists the device.
6. A device acts only through the live Shares that list it, not every Share of its person.
   When one of several stops listing it, its connection ends, so every request and feed it had
   open through that Share closes; it may connect again through the Shares that still list it.

The Relay route must be on for a Teammate to connect; a Share does not turn it on.

## What a Teammate reaches

`decideTeammate` (`gate.ts`) applies the protocol's `decideShareAccess` to what the request
touches, which `targets.ts` resolves from the payload: a session touches itself and the
Constellation it leads or works for, so a Constellation's Share covers Workers added later.
Everything off the allowlist is the owner's: Share management, archiving, terminals, file
reads and writes, every Host-wide call.

- `git.diff` is allowed only for a covered session's Turns, and only in the directory that
  session runs in. The gate resolves the Turns it names from Host state: each must be that
  session's, and a run in order, or the request is `NotShared`. A Turn without its `after`
  checkpoint is read up to the working tree only while the last Turn is still working
  (`../git/diffScope.ts`); otherwise the diff is not found.
- A request that passes also carries the Share's role, which decides who may resolve a Comment.
- A request that passes carries the Share it acts through (`RequestShare`): `dispatch` records
  `Actor.Teammate` and decides Turns on that Share's Grant.
- **Turns follow the Share's Grant** (`teammatesMayAct` in `../transport/userAccess.ts` is
  on, ENG-941): a Contributor sends, steers and interrupts; a Commenter is refused
  (`NotGranted`). A Turn into a session that approves for itself also needs `approve`
  (ADR 0078), which a Contributor holds.
- **A shared session queues Turns.** While a live Share covers a session (`shared.ts`), a Turn
  sent with one in flight joins its queue, first in first out with no owner priority, and its
  author or the owner may cancel or edit it (`../engine/README.md`, Queued Turns).
- A Teammate's connection has the Extension gateway's Wire and RPC limits.

## Trust

- The issuer is pinned on the Share. Keys are fetched from `{issuer}/api/auth/jwks` only, over
  https (http only for an Account Server on this machine), cached, and refetched for an unknown
  `kid` at most every 30 seconds.
- A statement never holds a connection for longer than `STATEMENT_LIFETIME_S`, whatever its
  `exp` says. It is refused before its `nbf`, with an `iat` ahead of the Host, or past its
  `exp`, each with 30 seconds of clock skew (`CLOCK_SKEW_MS`). Only `EdDSA` is accepted.
- An issuer's answers are bounded: the devices list is read up to 64 KiB and 16 devices, the
  JWKS up to 16 KiB and 16 keys, with field lengths capped; a longer body is abandoned unread.
  A redirect is refused, and so is an answer that names another origin.
- A device the issuer lists for another person, or with a statement the Host can't verify, is
  left out and a warning is logged; the rest of the list stands.
- If the issuer can't be reached, devices stay until their statements lapse (15 minutes at
  most); nobody new joins. A `401` or `404` empties the list.
- Revoking also ends the capability at the issuer (`DELETE`), best effort, and forgets it.

## Cost

With no live Share nothing runs: no request, no timer, and the JWKS is never fetched. The
store is opened at start. While a Share is live there is one long-poll per Share (the issuer
holds it up to 60 s) and one timer, set for the next Share expiry or statement lapse. Presence
is driven by the feeds' own lifetimes.

## Tests

`issuer.testing.ts` is a fake Account Server: in process as a `fetch`, or over HTTP.
`statement.test.ts`, `issuer.test.ts`, `service.test.ts`, `gate.test.ts` and
`coAuthors.test.ts` (a Teammate's Turn through a real Share gets its trailer) are fast;
`teammate.slow.test.ts` runs a Teammate's device through a real relay process.

---
status: proposed (ENG-941)
---

# Accounts vouch for people; Hosts decide what they may do

## Context

Shared Sessions (ENG-941) lets an owner share one Agent Session or Constellation with a Teammate,
who reaches the owner's Host through the Polaris Relay. Polaris had no notion of a person: the
relay knows device keys, a Linked Device is one of the user's own devices, and the Desktop App's
user key is derived per Host from the app's own name for it, so a Teammate can't have one.

An invite code bound to a name the owner typed would have worked without a server, but gives no
real identity, no way to find a person, and no base for Teams, shared always-on agents or billing.

## Decision

- Accounts are optional and exist for sharing and team work. Using Polaris alone on your own
  Hosts never needs one. A Client may hold several Accounts (say, work and personal), each on an
  Account Server; Polaris Cloud is ours, and anyone can run their own.
- An Account holds a person (ID, display name, commit email) and vouches for their devices: the
  Account Server signs a short-lived statement binding the person to a device's relay key, and
  publishes its signing keys as a JWKS.
- A Share is stored on the owner's Host with the Teammate's person ID and the Account Server's
  issuer URL, pinned when the Invite is created. A Teammate's device connects as a relay peer; the
  Host admits it only if a statement from that issuer, verified against keys fetched from that
  issuer over TLS, binds its key to that person, and a live Share names them. Each new device is
  recorded in the share log.
- The Account Server never decides access and is never on the data path. The relay keeps routing
  by key and never consults it. Invites and finding people work only within one Account Server.
- A user's access to their own Hosts stays local (ENG-927): an Account may suggest "this is your
  device", but an enrolled Desktop App still approves it.

## Consequences

A breached Account Server can vouch for an attacker's key as a Teammate, but only reaches what
live Shares from that issuer already allow that person, and each new device shows in the share
log. It can never grant user access to a Host, and no other server can vouch for its people.
Statements live 15 minutes, so signing a person out cuts them off within that window; revoking a
Share on the Host cuts them off at once. A server that is down stops new devices from joining and
statements from renewing; it never locks anyone out of their own Host.

---
status: proposed
amends: ADR 0078
---

# Linked Devices prove a linked Noise key

## Context

Over the Polaris Relay (ADR 0080), a Linked Device is a Client on the network, so ADR 0078's
"token-less means Client" can't apply to it. The relay authenticates relay addresses for
routing, but it is not trusted with who may act on a Host: it could forge a source address or
replay a frame. Linking happens once in the Desktop App, by QR code, before the relay will
route anything between the device and the Host.

## Decision

The Daemon grants Client power on the Relay route only to a Noise IK session whose proven
device static key is a Linked Device's on this Host, and only from the relay address stored
with that key. The connection acts as that device: commands record it as the `LinkedDevice`
Actor, and unlinking updates the relay's peers and ends its session in the same call.

Linking uses a one-time secret in the link string (QR code), valid five minutes. Both sides
derive a throwaway relay identity from it; the Host lists that identity's address as a peer
while the link is open. The device dials with it and sends, inside its handshake init
(encrypted to the Host's static key), its own relay address, its name and a keyed BLAKE2b
proof of the secret over its Noise key and address. The Host stores the device only when the
proof checks, so a relay that forges the link address still can't link a device.

## Consequences

- Anyone who reads the QR code within five minutes can link a device, as with any QR link; the
  Desktop App shows it only on request, and every link is listed and can be unlinked.
- The Desktop App shares a device to its other Hosts with `devices.add`, from the keys one Host
  already proved.
- The relay can still deny service: drop frames, or replay an old handshake init (Noise IK's
  first message has no replay protection), which replaces the device's session; it can't read
  or act. The device handshakes again.
- The Host's relay identity and Noise static key live in HostSecrets (ADR 0079): the Keychain
  on a Mac, a user-only file elsewhere.
- Older Clients can't decode the new Actor: they read it as `Client` unless they announce
  `actor.linked-device`.

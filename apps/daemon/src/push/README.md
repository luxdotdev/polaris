# Push to Linked Devices

The Daemon pushes Needs You and finished Turns to Linked Devices through the Polaris Relay and
APNs (`apps/relay/README.md`, Push; `apps/site/app/api/push/README.md`). The relay and the push
service carry each payload sealed to the device and can't read it.

| File | What |
|---|---|
| `plan.ts` | Which Host stream items push: each new approval or question at once; a finished Turn once its session stays Idle with no background tasks for 3 s (ADR 0073). Pure. |
| `notifier.ts` | `PushNotifier`: follows the Engine's Host stream (`PushHostEvents`) only while some device is registered, runs the plan and its settle timer, and wakes each registered device. |
| `seal.ts` | HPKE base mode, DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, info `polaris-push/1` ([`@hpke/core`](https://github.com/dajiaji/hpke-js), MIT). CryptoKit's `P256_SHA256_AES_GCM_256` opens it. |

## Registration

A device registers over its own Relay route connection with `devices.registerPush { token,
environment, pushKey, ticket }`: its APNs token, `sandbox` or `production`, the public half of
the P-256 key its Notification Service Extension holds, and its ticket for this Host (Ed25519
by its relay identity over this Host's relay address, environment and token). The Daemon
checks the ticket and the key, and keeps the registration in `linked-devices.sqlite`. Only a
Linked Device's connection may register (`not-a-device` otherwise). A new registration
replaces the last one, so the app rotates its key or token by registering again. Unlinking the
device deletes its registration; `unregistered` from APNs deletes it until the device
registers again.

## Cost

No registration: no subscription, no timers. With one: a Host stream subscription in memory,
and a timer only while a finished Turn settles. Each push is one `wake` on the existing relay
socket; nothing is queued while it is down.

## Threat model

- The relay sees, per wake: the APNs token, the environment, the payload's size, the time, and
  which host relay address woke which device address. Never content.
- The push service sees the token, environment and sealed payload. Never content, nor who sent it.
- The ticket stops a host from waking a device that didn't register with it under that host's
  address. It doesn't bind the token to the device: a party that learns an APNs token (the relay
  operator, a Host the device registered with) could mint its own ticket for that token. Without
  the device's push key it can only cause the generic "Open Polaris" alert, which the extension
  can't open. Binding tokens to devices at the push service is a follow-up.
- A push names the Host, session and request ids in its sealed body; the app answers over its
  own end-to-end session, never through the push path.

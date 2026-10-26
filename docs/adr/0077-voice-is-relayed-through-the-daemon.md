---
status: accepted
---

# Voice is relayed through the Daemon

## Context

The G2 gives raw 16 kHz PCM and no speech-to-text. Even advises against keys in an `.ehpk`,
which can be unpacked. The choices were a user's key in the WebView streaming straight to
Deepgram, a Daemon-minted short-lived Deepgram token, or relaying audio through the Daemon.

## Decision

`voice.transcribe` streams PCM to the Daemon, which forwards it to a provider behind an
interface (Deepgram first) using a key kept in the Host's settings, and streams interim and final
text back. A transcript becomes a Turn only when the user sends it.

## Consequences

- The key never leaves the Host, and any provider or a local model can plug in.
- One extra hop (tens of milliseconds over Tailscale) and about 32 KB/s per listening Extension.
- Voice depends on the Host being reachable, like everything else an Extension does.

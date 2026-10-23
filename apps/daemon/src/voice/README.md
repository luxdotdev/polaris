# Voice

`voice.transcribe` (ADR 0077, ENG-404): an Extension with the `voice` Grant streams 16 kHz s16le
mono PCM to the Daemon as a client-offered Wire blob (`{ audio: BlobId }`, taken with
`takeStream`, idle timeout on: a live microphone sends samples even in silence), and gets
`VoiceTranscript` snapshots `{ finalText, interimText, finished }` back. Ending the blob finishes
the stream with one `finished` snapshot; ending the RPC early stops the provider.

| File | What |
|---|---|
| `provider.ts` | `VoiceProvider` (audio in, interim and final results out) and `snapshots`, the fold into `VoiceTranscript`s. |
| `deepgram.ts` | Deepgram's streaming API: `wss://api.deepgram.com/v1/listen`, linear16 at 16000, the key as `Authorization: Token …`, `CloseStream` at the end, `KeepAlive` during pauses. A 401/403 handshake is `key-rejected`. |
| `keys.ts` | The provider's key in `HostSecrets` (`secrets/`, ADR 0079): read per transcription, checked when set, `no-key` with how to set one. |
| `VoiceRpcs.ts` | The handlers for `voice.transcribe`, `voice.settings` and `voice.setKey`; at most `MAX_TRANSCRIPTIONS` (4) at once per Host, then `busy`, since each is a provider connection billed to the key. |
| `cli.ts` | `polaris voice key set|clear|status`; `set` reads the key from stdin, hidden on a terminal. |

`voice.settings` and `voice.setKey` are Client-only (`grants.ts`): Extensions never see or change
the key, and no response carries it.

## Tests

`voice.socket.test.ts` runs the real server and Wire with a fake provider; `deepgram.test.ts`
runs the client against a local fake of Deepgram's API. The real-Deepgram smoke runs on macOS
with a key (it speaks with `say`):

```
POLARIS_DEEPGRAM_SMOKE_KEY=<key> bun test apps/daemon/src/voice/deepgram.test.ts
```

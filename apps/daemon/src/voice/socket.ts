import { VOICE_SAMPLE_RATE, type VoiceError } from "@polaris/protocol";
import { Effect, Schedule, Stream } from "effect";
import { providerFailed } from "./provider.ts";

interface VoiceSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  readonly send: (data: string | Uint8Array) => void;
}

const BUFFER_LIMIT = 64 * 1024;

const AUDIO_FRAME_BYTES = VOICE_SAMPLE_RATE * 2;

/** Pauses the audio reader while the provider socket has buffered output. */
const send = Effect.fnUntraced(function* (socket: VoiceSocket, data: string | Uint8Array) {
  while (socket.bufferedAmount > BUFFER_LIMIT && socket.readyState === WebSocket.OPEN)
    yield* Effect.sleep("10 millis");

  if (socket.readyState !== WebSocket.OPEN)
    return yield* providerFailed("Deepgram closed before receiving the audio");

  yield* Effect.try({
    try: () => socket.send(data),
    catch: () => providerFailed("Could not send audio to Deepgram"),
  });
});

/** Sends bounded frames, then CloseStream; KeepAlive only while audio is paused. */
export const pump = Effect.fnUntraced(function* (
  socket: VoiceSocket,
  audio: Stream.Stream<Uint8Array, VoiceError>
) {
  let lastSent = Date.now();

  const write = (data: string | Uint8Array) =>
    send(socket, data).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          lastSent = Date.now();
        })
      )
    );

  const keepAlive = Effect.suspend(() =>
    Date.now() - lastSent >= 4000 ? write(JSON.stringify({ type: "KeepAlive" })) : Effect.void
  ).pipe(Effect.repeat(Schedule.spaced("4 seconds")));

  yield* Effect.forkScoped(keepAlive);
  yield* Stream.runForEach(audio, (chunk) =>
    Effect.gen(function* () {
      for (let offset = 0; offset < chunk.byteLength; offset += AUDIO_FRAME_BYTES)
        yield* write(chunk.subarray(offset, offset + AUDIO_FRAME_BYTES));
    })
  );
  yield* write(JSON.stringify({ type: "CloseStream" }));
});

import { VOICE_SAMPLE_RATE, VoiceError } from "@polaris/protocol";
import { Effect, Stream } from "effect";

export interface VoiceLimits {
  readonly maxAudioBytes: number;
  readonly maxDurationMs: number;
}

/** Five minutes of s16le mono PCM, bounded in bytes and elapsed time independently. */
export const VOICE_LIMITS: VoiceLimits = {
  maxAudioBytes: VOICE_SAMPLE_RATE * 2 * 300,
  maxDurationMs: 300_000,
};

export const boundedAudio = (audio: Stream.Stream<Uint8Array, VoiceError>, limits: VoiceLimits) =>
  Stream.suspend(() => {
    let bytes = 0;

    return audio.pipe(
      Stream.mapEffect((chunk) => {
        bytes += chunk.byteLength;

        return bytes > limits.maxAudioBytes
          ? Effect.fail(
              new VoiceError({
                reason: "audio-failed",
                message: `Voice audio exceeds ${limits.maxAudioBytes} bytes`,
              })
            )
          : Effect.succeed(chunk);
      })
    );
  });

export const transcriptionDeadline = (limits: VoiceLimits) =>
  Effect.andThen(
    Effect.sleep(limits.maxDurationMs),
    Effect.fail(
      new VoiceError({
        reason: "audio-failed",
        message: "Voice transcription exceeded its time limit",
      })
    )
  );

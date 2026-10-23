/** Handlers for `voice.transcribe`, `voice.settings` and `voice.setKey` (capability `voice`). */
import { VoiceError, VoiceRpcs } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { HostSecrets } from "../secrets/index.ts";
import { BlobChannel } from "../services.ts";
import { readKey, setKey, voiceSettings } from "./keys.ts";
import { snapshots, VoiceProvider } from "./provider.ts";

const audioFailed = (error: { readonly message: string }) =>
  new VoiceError({ reason: "audio-failed", message: `The audio stream failed: ${error.message}` });

/** Each one is a provider connection billed to the user's key. */
export const MAX_TRANSCRIPTIONS = 4;

const busy = (limit: number) =>
  new VoiceError({
    reason: "busy",
    message: `This Host runs at most ${limit} ${limit === 1 ? "transcription" : "transcriptions"} at once; end one first.`,
  });

/** Requires `HostSecrets` and a `VoiceProvider`. */
export const makeVoiceRpcs = (limit = MAX_TRANSCRIPTIONS) =>
  VoiceRpcs.toLayer(
    Effect.gen(function* () {
      const provider = yield* VoiceProvider;
      let active = 0;

      /** A transcription slot for the stream's lifetime, or `busy`. */
      const slot = Effect.acquireRelease(
        Effect.suspend(() => {
          if (active >= limit) return Effect.fail(busy(limit));

          active += 1;

          return Effect.void;
        }),
        () =>
          Effect.sync(() => {
            active -= 1;
          })
      );

      const secrets = yield* HostSecrets;
      const withSecrets = Effect.provideService(HostSecrets, secrets);

      return {
        "voice.transcribe": ({ audio }) =>
          Stream.unwrap(
            Effect.gen(function* () {
              const key = yield* withSecrets(readKey(provider.kind));

              yield* slot;
              const blobs = yield* BlobChannel;
              const pcm = blobs.takeStream(audio).pipe(Stream.mapError(audioFailed));

              return snapshots(provider.transcribe(key, pcm));
            })
          ),
        "voice.settings": () => withSecrets(voiceSettings(provider.kind)),
        "voice.setKey": ({ provider: kind, key }) => withSecrets(setKey(kind, key)),
      };
    })
  );

export const VoiceRpcsLive = makeVoiceRpcs();

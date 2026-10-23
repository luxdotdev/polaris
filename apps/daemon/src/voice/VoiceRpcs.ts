/** Handlers for `voice.transcribe`, `voice.settings` and `voice.setKey` (capability `voice`). */
import { VoiceError, VoiceRpcs } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { HostSecrets } from "../secrets/index.ts";
import { BlobChannel } from "../services.ts";
import { readKey, setKey, voiceSettings } from "./keys.ts";
import { snapshots, VoiceProvider } from "./provider.ts";

const audioFailed = (error: { readonly message: string }) =>
  new VoiceError({ reason: "audio-failed", message: `The audio stream failed: ${error.message}` });

/** Requires `HostSecrets` and a `VoiceProvider`. */
export const VoiceRpcsLive = VoiceRpcs.toLayer(
  Effect.gen(function* () {
    const provider = yield* VoiceProvider;
    const secrets = yield* HostSecrets;
    const withSecrets = Effect.provideService(HostSecrets, secrets);

    return {
      "voice.transcribe": ({ audio }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const key = yield* withSecrets(readKey(provider.kind));
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

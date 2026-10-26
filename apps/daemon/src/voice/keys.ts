/**
 * The voice provider's key in the Host's secure storage (`secrets/`). It is
 * read at the start of each transcription, so a key set from Settings or
 * `polaris voice key set` applies without restarting the Daemon.
 */
import { VoiceError, type VoiceProviderKind, VoiceSettings } from "@polaris/protocol";
import { Effect, Option, Redacted } from "effect";
import { HostSecrets, type SecretStorageError } from "../secrets/index.ts";

export const secretKeyFor = (provider: VoiceProviderKind) => `voice/${provider}`;

const PROVIDER_NAMES: Record<VoiceProviderKind, string> = { deepgram: "Deepgram" };

/** Deepgram's API key secrets are letters and digits (40 hex characters today). */
const DEEPGRAM_KEY = /^[A-Za-z0-9]{20,128}$/;

const storageFailed = (error: SecretStorageError) =>
  new VoiceError({ reason: "storage-failed", message: error.message });

export const NO_KEY_MESSAGE =
  "No Deepgram key on this Host. Add one in Settings → Voice, or run `polaris voice key set` on the Host.";

/** A pasted key, trimmed and checked; the error never repeats it. */
export const parseKey = (provider: VoiceProviderKind, raw: Redacted.Redacted<string>) => {
  const key = Redacted.value(raw).trim();

  return DEEPGRAM_KEY.test(key)
    ? Effect.succeed(Redacted.make(key))
    : Effect.fail(
        new VoiceError({
          reason: "invalid-key",
          message: `That is not a ${PROVIDER_NAMES[provider]} API key: it should be letters and digits only.`,
        })
      );
};

export const readKey = Effect.fn("voice.readKey")(function* (provider: VoiceProviderKind) {
  const secrets = yield* HostSecrets;
  const key = yield* secrets.get(secretKeyFor(provider)).pipe(Effect.mapError(storageFailed));

  if (Option.isNone(key))
    return yield* new VoiceError({ reason: "no-key", message: NO_KEY_MESSAGE });

  return key.value;
});

export const voiceSettings = Effect.fn("voice.settings")(function* (provider: VoiceProviderKind) {
  const secrets = yield* HostSecrets;
  const key = yield* secrets.get(secretKeyFor(provider)).pipe(Effect.mapError(storageFailed));

  return new VoiceSettings({ provider, keySet: Option.isSome(key), store: secrets.store });
});

/** Stores `key` (or removes the key when null) and answers the new settings. */
export const setKey = Effect.fn("voice.setKey")(function* (
  provider: VoiceProviderKind,
  key: Redacted.Redacted<string> | null
) {
  const secrets = yield* HostSecrets;
  const name = secretKeyFor(provider);

  if (key === null) yield* secrets.remove(name).pipe(Effect.mapError(storageFailed));
  else {
    const parsed = yield* parseKey(provider, key);
    yield* secrets.set(name, parsed).pipe(Effect.mapError(storageFailed));
  }

  return yield* voiceSettings(provider);
});

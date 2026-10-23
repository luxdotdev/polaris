/**
 * Voice (ADR 0077, ENG-404): an Extension streams microphone audio to the
 * Daemon, which relays it to a speech-to-text provider with a key kept on the
 * Host and streams the text back. A transcript becomes a Turn only when sent.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { BlobId } from "./ids.ts";

/** The only audio `voice.transcribe` takes: 16 kHz, signed 16-bit little-endian, mono. */
export const VOICE_SAMPLE_RATE = 16_000;

export const VoiceProviderKind = Schema.Literals(["deepgram"]);

export type VoiceProviderKind = typeof VoiceProviderKind.Type;

/** What has been heard so far. Each snapshot replaces the last; the final one has `finished`. */
export class VoiceTranscript extends Schema.Class<VoiceTranscript>("VoiceTranscript")({
  /** Text the provider will not revise. */
  finalText: Schema.String,
  /** The provider's current guess at what follows `finalText`; it may still change. */
  interimText: Schema.String,
  finished: Schema.Boolean,
}) {}

export const VoiceErrorReason = Schema.Literals([
  /** No key for the provider on this Host. */
  "no-key",
  /** The provider refused the key. */
  "key-rejected",
  /** The provider could not be reached or failed mid-stream. */
  "provider-failed",
  /** The audio blob failed or broke the format. */
  "audio-failed",
  /** The Host's secure storage could not be read or written. */
  "storage-failed",
  /** A key that is not one the provider issues. */
  "invalid-key",
]);

export class VoiceError extends Schema.TaggedError<VoiceError>()("VoiceError", {
  reason: VoiceErrorReason,
  message: Schema.String,
}) {}

/**
 * Transcribes the audio the caller streams as the blob `audio` (raw PCM at
 * `VOICE_SAMPLE_RATE`, s16le, mono, any chunk sizes). Snapshots arrive as the
 * provider hears; ending the blob finishes the stream with one `finished`
 * snapshot, and ending the stream early stops the transcription.
 */
export const VoiceTranscribe = Rpc.make("voice.transcribe", {
  payload: { audio: BlobId },
  success: VoiceTranscript,
  error: VoiceError,
  stream: true,
});

/** Where the Host keeps the key: the macOS Keychain, or a file only its user can read. */
export const VoiceKeyStore = Schema.Literals(["keychain", "file"]);

export class VoiceSettings extends Schema.Class<VoiceSettings>("VoiceSettings")({
  provider: VoiceProviderKind,
  /** Whether a key is set. The key itself never leaves the Host. */
  keySet: Schema.Boolean,
  store: VoiceKeyStore,
}) {}

export const GetVoiceSettings = Rpc.make("voice.settings", {
  success: VoiceSettings,
  error: VoiceError,
});

/** Stores the provider's key on the Host, replacing any; `null` removes it. */
export const SetVoiceKey = Rpc.make("voice.setKey", {
  payload: {
    provider: VoiceProviderKind,
    key: Schema.NullOr(Schema.RedactedFromValue(Schema.String)),
  },
  success: VoiceSettings,
  error: VoiceError,
});

export class VoiceRpcs extends RpcGroup.make(VoiceTranscribe, GetVoiceSettings, SetVoiceKey) {}

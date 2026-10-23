/**
 * Settings → Voice over IPC (ENG-404): each Host's speech-to-text key. The key crosses IPC once,
 * renderer to main, as a plain string; main wraps it in `Redacted` for `voice.setKey`. The
 * renderer imports this for types only.
 */
import type { VoiceSettings } from "@polaris/protocol";
import { VoiceProviderKind } from "@polaris/protocol";
import { Schema } from "effect";

const HostKey = Schema.String.check(Schema.isMinLength(1));

export const VoiceRequestInputs = {
  /** Whether the Host has a key, and where it keeps it; never the key (capability `voice`). */
  "voice.settings": Schema.Struct({ hostKey: HostKey }),
  /** Stores the key on the Host, replacing any; null removes it. */
  "voice.setKey": Schema.Struct({
    hostKey: HostKey,
    provider: VoiceProviderKind,
    key: Schema.NullOr(Schema.String),
  }),
} as const;

export interface VoiceSettingsView {
  readonly provider: VoiceSettings["provider"];
  readonly keySet: boolean;
  readonly store: VoiceSettings["store"];
}

export interface VoiceRequestOutputs {
  readonly "voice.settings": VoiceSettingsView;
  readonly "voice.setKey": VoiceSettingsView;
}

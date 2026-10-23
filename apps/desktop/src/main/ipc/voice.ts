/**
 * Settings → Voice (ENG-404): forwards `voice.settings` and `voice.setKey` to the Host. The key
 * is wrapped in `Redacted` as soon as it arrives and is never logged or echoed back.
 */
import type { VoiceSettings } from "@polaris/protocol";
import { Effect, Redacted } from "effect";
import type { RequestInput } from "../../shared/contract.ts";
import type { VoiceSettingsView } from "../../shared/voiceContract.ts";
import { HostDirectory, toIpcError } from "../hosts.ts";

const view = ({ provider, keySet, store }: VoiceSettings): VoiceSettingsView => ({
  provider,
  keySet,
  store,
});

export const voiceHandlers = {
  "voice.settings": ({ hostKey }: RequestInput<"voice.settings">) =>
    HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
      Effect.flatMap((c) => c.session),
      Effect.flatMap((s) => s.client["voice.settings"]()),
      Effect.map(view),
      Effect.mapError(toIpcError)
    ),
  "voice.setKey": ({ hostKey, provider, key }: RequestInput<"voice.setKey">) => {
    const secret = key === null ? null : Redacted.make(key);

    return HostDirectory.use((dir) => dir.connection(hostKey)).pipe(
      Effect.flatMap((c) => c.session),
      Effect.flatMap((s) => s.client["voice.setKey"]({ provider, key: secret })),
      Effect.map(view),
      Effect.mapError(toIpcError)
    );
  },
};

/**
 * One Host's Deepgram key for Settings → Voice: whether it is set (`voice.settings`), and
 * setting or removing it (`voice.setKey`). The key is passed straight through, never stored.
 */
import { useCallback, useEffect, useState } from "react";
import type { IpcError } from "../../../../shared/api.ts";
import { polaris } from "../../bridge.ts";
import type { VoiceKeyState } from "../model/voice.ts";

export const useVoiceKey = (hostKey: string, enabled: boolean) => {
  const [state, setState] = useState<VoiceKeyState>({ kind: "loading" });

  const load = useCallback(async () => {
    const result = await polaris().request("voice.settings", { hostKey });

    setState(
      result.ok
        ? { kind: "ready", settings: result.value }
        : { kind: "failed", message: result.error.message }
    );
  }, [hostKey]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  /** Stores `key` on the Host, or removes it (null); answers the Host's refusal, if any. */
  const setKey = useCallback(
    async (key: string | null): Promise<IpcError | null> => {
      const result = await polaris().request("voice.setKey", {
        hostKey,
        provider: "deepgram",
        key,
      });

      if (!result.ok) return result.error;
      setState({ kind: "ready", settings: result.value });

      return null;
    },
    [hostKey]
  );

  return { state, setKey };
};

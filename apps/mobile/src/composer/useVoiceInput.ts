/**
 * The small optional mic: records 16 kHz s16le mono PCM (expo-audio's stream), dictates it through
 * the Host, and writes what it hears after what was typed. Null where the Host has no `voice`.
 */
import { VOICE_SAMPLE_RATE } from "@polaris/protocol";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { HostConnection } from "../runtime/hostConnection.ts";
import type { VoiceInput } from "./controls.tsx";
import { pcmConverter } from "./pcm.ts";
import { type Dictation, startDictation, withHeard } from "./voice.ts";

const NO_MICROPHONE = "Polaris can't use the microphone. Allow it in Settings → Polaris.";

export interface VoiceOptions {
  readonly connection: HostConnection | null;
  /** The field's text now; dictation adds after it. */
  readonly text: string;
  readonly onText: (text: string) => void;
}

export const useVoiceInput = ({ connection, text, onText }: VoiceOptions): VoiceInput | null => {
  const live = useLiveHost(connection);
  const able = live?.capabilities.includes("voice") ?? false;
  const [listening, setListening] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dictation = useRef<Dictation | null>(null);
  const convert = useRef(pcmConverter());
  const latest = useRef({ text, onText });

  latest.current = { text, onText };

  const { stream } = useAudioStream({
    sampleRate: VOICE_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => dictation.current?.push(convert.current(buffer)),
  });

  const begin = useCallback(async () => {
    if (connection === null) return;
    setFailure(null);

    if (!(await requestRecordingPermissionsAsync()).granted) {
      setFailure(NO_MICROPHONE);

      return;
    }

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    const typed = latest.current.text;

    convert.current = pcmConverter();
    dictation.current = startDictation(connection, {
      heard: (heard) => latest.current.onText(withHeard(typed, heard)),
      ended: (why) => {
        stream.stop();
        dictation.current = null;
        setListening(false);
        setFailure(why);
      },
    });
    setListening(true);

    try {
      await stream.start();
    } catch {
      dictation.current?.cancel();
      setFailure(NO_MICROPHONE);
    }
  }, [connection, stream]);

  const toggle = useCallback(() => {
    if (dictation.current === null) {
      void begin();

      return;
    }

    stream.stop();
    dictation.current.finish();
  }, [begin, stream]);

  useEffect(
    () => () => {
      dictation.current?.cancel();
      stream.stop();
    },
    [stream]
  );

  return useMemo(
    () => (able ? { listening, failure, toggle } : null),
    [able, listening, failure, toggle]
  );
};

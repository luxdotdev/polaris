/**
 * The small optional mic: records 16 kHz s16le mono PCM (expo-audio's stream), dictates it through
 * the Host, and writes what it hears after what was typed. Null where the Host has no `voice`.
 */
import { VOICE_SAMPLE_RATE } from "@polaris/protocol";
import { requestRecordingPermissionsAsync, setAudioModeAsync, useAudioStream } from "expo-audio";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveHost } from "../runtime/hosts.tsx";
import type { HostConnection } from "../runtime/hostConnection.ts";
import type { VoiceInput } from "./controls.tsx";
import { openMic, type Mic, type MicState } from "./mic.ts";
import { pcmConverter } from "./pcm.ts";
import { startDictation } from "./voice.ts";

export interface VoiceOptions {
  readonly connection: HostConnection | null;
  /** The field's text now; dictation adds after it. */
  readonly text: string;
  readonly onText: (text: string) => void;
}

const IDLE: MicState = { listening: false, failure: null };

const permitted = async () => {
  if (!(await requestRecordingPermissionsAsync()).granted) return false;
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

  return true;
};

export const useVoiceInput = ({ connection, text, onText }: VoiceOptions): VoiceInput | null => {
  const live = useLiveHost(connection);
  const able = live?.capabilities.includes("voice") ?? false;
  const [state, setState] = useState(IDLE);
  const convert = useRef(pcmConverter());
  const latest = useRef({ text, onText });
  const mic = useRef<Mic | null>(null);

  latest.current = { text, onText };

  const { stream } = useAudioStream({
    sampleRate: VOICE_SAMPLE_RATE,
    channels: 1,
    encoding: "int16",
    onBuffer: (buffer) => mic.current?.push(convert.current(buffer)),
  });

  const current = useMemo(
    () =>
      connection === null
        ? null
        : openMic({
            permitted,
            startAudio: () => {
              convert.current = pcmConverter();

              return stream.start();
            },
            stopAudio: () => stream.stop(),
            dictate: (callbacks) => startDictation(connection, callbacks),
            field: () => latest.current.text,
            write: (next) => {
              // Until the next render, the field is what was just written.
              latest.current = { ...latest.current, text: next };
              latest.current.onText(next);
            },
            changed: setState,
          }),
    [connection, stream]
  );

  mic.current = current;

  useEffect(
    () => () => {
      current?.release();
      setState(IDLE);
    },
    [current]
  );

  return useMemo(
    () =>
      able && current !== null
        ? { ...state, toggle: current.toggle, release: current.release }
        : null,
    [able, current, state]
  );
};

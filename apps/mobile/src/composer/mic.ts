/**
 * The mic outside React: one dictation at a time, latched on the tap, and callbacks that act
 * only while their dictation is still the current one.
 */
import {
  type Dictated,
  type Dictation,
  type DictationCallbacks,
  dictate,
  dictateFrom,
} from "./voice.ts";

export const NO_MICROPHONE = "Polaris can't use the microphone. Allow it in Settings → Polaris.";

export interface MicState {
  readonly listening: boolean;
  readonly failure: string | null;
}

export interface MicDeps {
  /** Asks for the microphone and readies audio; false when it was refused. */
  readonly permitted: () => Promise<boolean>;
  readonly startAudio: () => Promise<void>;
  readonly stopAudio: () => void;
  readonly dictate: (callbacks: DictationCallbacks) => Dictation;
  /** The field's text now. */
  readonly field: () => string;
  readonly write: (text: string) => void;
  readonly changed: (state: MicState) => void;
}

export interface Mic {
  readonly toggle: () => void;
  /** One buffer of PCM for the current dictation. */
  readonly push: (pcm: Uint8Array) => void;
  /** Send or Queue took the field, or the screen went: the dictation stops and writes nothing more. */
  readonly release: () => void;
}

interface Operation {
  dictation: Dictation | null;
  finishing: boolean;
}

export const openMic = (deps: MicDeps): Mic => {
  let current: Operation | null = null;
  let state: MicState = { listening: false, failure: null };

  const emit = (patch: Partial<MicState>) => {
    state = { ...state, ...patch };
    deps.changed(state);
  };

  const owns = (op: Operation) => current === op;

  const release = () => {
    const op = current;

    if (op === null) return;
    current = null;
    op.dictation?.cancel();
    deps.stopAudio();
    emit({ listening: false });
  };

  const listen = (op: Operation) => {
    let at: Dictated = dictateFrom(deps.field());

    return deps.dictate({
      heard: (heard) => {
        if (!owns(op)) return;
        const field = deps.field();
        at = dictate(at, field, heard);

        if (at.written !== field) deps.write(at.written);
      },
      ended: (why) => {
        if (!owns(op)) return;
        current = null;
        deps.stopAudio();
        emit({ listening: false, failure: why });
      },
    });
  };

  const begin = async (op: Operation) => {
    emit({ failure: null });
    const granted = await deps.permitted().catch(() => false);

    if (!owns(op)) return;

    if (!granted) {
      current = null;

      return emit({ failure: NO_MICROPHONE });
    }

    op.dictation = listen(op);
    emit({ listening: true });

    try {
      await deps.startAudio();
    } catch {
      if (!owns(op)) return;
      release();
      emit({ failure: NO_MICROPHONE });

      return;
    }

    if (!owns(op) && current === null) deps.stopAudio();
  };

  return {
    toggle: () => {
      const op = current;

      if (op === null) {
        const started: Operation = { dictation: null, finishing: false };
        current = started;

        return void begin(started);
      }

      if (op.dictation === null) return release();

      if (op.finishing) return;
      op.finishing = true;
      deps.stopAudio();
      op.dictation.finish();
    },
    push: (pcm) => {
      if (current?.finishing === false) current.dictation?.push(pcm);
    },
    release,
  };
};

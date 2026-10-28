/**
 * Microphone buffers to the only audio `voice.transcribe` takes: 16 kHz s16le mono. The
 * phone may deliver another rate or more channels than asked; those are mixed down and resampled.
 */
import { VOICE_SAMPLE_RATE } from "@polaris/protocol";

/** One buffer as expo-audio's stream delivers it with `encoding: "int16"`. */
export interface PcmBuffer {
  readonly data: ArrayBuffer;
  readonly sampleRate: number;
  readonly channels: number;
}

const BYTES = 2;

const mono = (buffer: PcmBuffer): Int16Array => {
  const view = new DataView(buffer.data);
  const channels = Math.max(1, buffer.channels);
  const frames = Math.floor(buffer.data.byteLength / (BYTES * channels));
  const out = new Int16Array(frames);

  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;

    for (let c = 0; c < channels; c++) sum += view.getInt16((frame * channels + c) * BYTES, true);
    out[frame] = Math.round(sum / channels);
  }

  return out;
};

const littleEndian = (samples: ArrayLike<number>): Uint8Array => {
  const bytes = new Uint8Array(samples.length * BYTES);
  const view = new DataView(bytes.buffer);

  for (let i = 0; i < samples.length; i++) view.setInt16(i * BYTES, samples[i] ?? 0, true);

  return bytes;
};

/**
 * A converter for one recording: linear resampling counts its output and input across buffers,
 * so chunk edges leave no clicks or drift.
 */
export const pcmConverter = () => {
  let emitted = 0;
  let consumed = 0;
  let previous = 0;

  return (buffer: PcmBuffer): Uint8Array => {
    const samples = mono(buffer);

    if (buffer.sampleRate === VOICE_SAMPLE_RATE || samples.length === 0)
      return littleEndian(samples);
    const step = buffer.sampleRate / VOICE_SAMPLE_RATE;
    const out: Array<number> = [];

    // A position in this buffer's samples; -1 is the previous buffer's last one.
    for (
      let at = emitted * step - consumed;
      at < samples.length - 1;
      at = ++emitted * step - consumed
    ) {
      const index = Math.floor(at);
      const from = index < 0 ? previous : (samples[index] ?? 0);
      const to = samples[index + 1] ?? from;

      out.push(Math.round(from + (to - from) * (at - index)));
    }

    consumed += samples.length;
    previous = samples[samples.length - 1] ?? 0;

    return littleEndian(out);
  };
};

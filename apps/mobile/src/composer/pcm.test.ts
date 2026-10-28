import { describe, expect, test } from "bun:test";
import { pcmConverter, type PcmBuffer } from "./pcm.ts";

const buffer = (samples: ReadonlyArray<number>, sampleRate: number, channels = 1): PcmBuffer => {
  const data = new ArrayBuffer(samples.length * 2);
  const view = new DataView(data);

  samples.forEach((sample, i) => view.setInt16(i * 2, sample, true));

  return { data, sampleRate, channels };
};

const samplesOf = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return Array.from({ length: bytes.byteLength / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe("microphone PCM to 16 kHz s16le mono", () => {
  test("16 kHz mono passes through unchanged, negative samples included", () => {
    expect(samplesOf(pcmConverter()(buffer([0, -1, 32767, -32768], 16_000)))).toEqual([
      0, -1, 32767, -32768,
    ]);
  });

  test("48 kHz stereo is mixed down and a third as long", () => {
    const frames = Array.from({ length: 480 }, () => [1000, 3000]).flat();
    const out = samplesOf(pcmConverter()(buffer(frames, 48_000, 2)));

    expect(out.length).toBe(160);
    expect(new Set(out)).toEqual(new Set([2000]));
  });

  test("a ramp split across buffers comes out as it does in one buffer", () => {
    const ramp = Array.from({ length: 441 * 4 }, (_, i) => i * 10);
    const whole = samplesOf(pcmConverter()(buffer(ramp, 44_100)));
    const split = pcmConverter();

    const parts = [ramp.slice(0, 300), ramp.slice(300, 1000), ramp.slice(1000)].flatMap((part) =>
      samplesOf(split(buffer(part, 44_100)))
    );

    expect(parts).toEqual(whole);
    expect(whole.length).toBe(640);
  });
});

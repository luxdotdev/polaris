import { expect, test } from "bun:test";
import type { PolarisClient, Transcript } from "@polaris/sdk";
import { fakeGlasses } from "../glasses/fake.testing.ts";
import { listen } from "./voice.ts";

const tick = () => Bun.sleep(10);

const provider = (heard: Array<number>, closed: () => void): Pick<PolarisClient, "transcribe"> => ({
  transcribe: async function* (_host, audio) {
    try {
      for await (const frame of audio) {
        heard.push(frame.byteLength);
        yield { finalText: "", interimText: "hello", finished: false };
      }

      yield { finalText: "hello", interimText: "", finished: true };
    } finally {
      closed();
    }
  },
});

test("cancel discards buffered audio and closes the provider without reporting a transcript", async () => {
  const glasses = fakeGlasses();
  const heard: Array<number> = [];
  const results: Array<Transcript> = [];
  let closed = false;

  const recording = listen(
    glasses,
    provider(heard, () => {
      closed = true;
    }),
    "h",
    {
      heard: (text) => results.push(text),
      failed: () => {},
    }
  );

  await tick();
  recording.push(new Uint8Array(3200));
  recording.push(new Uint8Array(3200));
  recording.cancel();
  await tick();
  expect(heard).toEqual([]);
  expect(results).toEqual([]);
  expect(closed).toBe(true);
  expect(glasses.microphoneOn()).toBe(false);
});

test("a slow microphone start cannot turn recording back on after cancel; retry keeps ownership", async () => {
  const glasses = fakeGlasses();
  const enabled = Promise.withResolvers<void>();
  let first = true;

  const surface = {
    ...glasses,
    microphone: async (on: boolean) => {
      if (on && first) {
        first = false;
        await enabled.promise;
      }

      return glasses.microphone(on);
    },
  };

  const callbacks = { heard: () => {}, failed: () => {} };

  const old = listen(
    surface,
    provider([], () => {}),
    "h",
    callbacks
  );

  await tick();
  old.cancel();

  const next = listen(
    surface,
    provider([], () => {}),
    "h",
    callbacks
  );

  enabled.resolve();
  await tick();
  expect(glasses.microphoneOn()).toBe(true);
  next.cancel();
  await tick();
  expect(glasses.microphoneOn()).toBe(false);
});

test("a stalled transcription stops the microphone and reports overflow", async () => {
  const glasses = fakeGlasses();
  const pending = Promise.withResolvers<IteratorResult<Transcript>>();
  const failures: Array<unknown> = [];

  const recording = listen(
    glasses,
    {
      transcribe: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => pending.promise,
          return: async () => {
            pending.resolve({ done: true, value: undefined });

            return { done: true, value: undefined };
          },
        }),
      }),
    },
    "h",
    { heard: () => {}, failed: (error) => failures.push(error) }
  );

  await tick();

  for (let i = 0; i < 21; i++) recording.push(new Uint8Array(3200));
  await tick();
  expect(failures.map(String)).toEqual(["Error: Audio couldn't keep up. Retry your reply."]);
  expect(glasses.microphoneOn()).toBe(false);
});

test("a finished transcript closes its iterator and microphone", async () => {
  const glasses = fakeGlasses();
  let released = false;
  const results: Array<Transcript> = [];
  listen(
    glasses,
    {
      transcribe: async function* () {
        try {
          yield { finalText: "hello", interimText: "", finished: true };
        } finally {
          released = true;
        }
      },
    },
    "h",
    { heard: (value) => results.push(value), failed: () => {} }
  );
  await tick();
  expect(results.map((value) => value.finalText)).toEqual(["hello"]);
  expect(released).toBe(true);
  expect(glasses.microphoneOn()).toBe(false);
});

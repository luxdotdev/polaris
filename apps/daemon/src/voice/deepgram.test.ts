/**
 * The Deepgram client against a local fake of its streaming API, and, with
 * `POLARIS_DEEPGRAM_SMOKE_KEY` set on macOS, against the real one with audio
 * from `say`.
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VoiceError } from "@polaris/protocol";
import { Effect, Exit, Predicate, Redacted, Stream } from "effect";
import { deepgramProvider } from "./deepgram.ts";
import { snapshots } from "./provider.ts";

const KEY = Redacted.make("0123456789abcdef0123456789abcdef01234567");

interface Seen {
  readonly url: URL;
  readonly authorization: string | null;
  readonly audio: Array<number>;
  readonly text: Array<string>;
}

let server: ReturnType<typeof Bun.serve> | undefined;

afterEach(() => {
  void server?.stop(true);
  server = undefined;
});

const results = (transcript: string, isFinal: boolean) =>
  JSON.stringify({
    type: "Results",
    is_final: isFinal,
    speech_final: isFinal,
    channel: { alternatives: [{ transcript, confidence: 0.9 }] },
  });

/** Answers each audio frame with an interim result and `CloseStream` with a final one. */
const fakeDeepgram = (options: { readonly status?: number } = {}) => {
  const seen: Seen = { url: new URL("ws://x"), authorization: null, audio: [], text: [] };

  server = Bun.serve({
    port: 0,
    fetch: (request, srv) => {
      seen.url.href = request.url;
      Object.assign(seen, { authorization: request.headers.get("authorization") });

      if (options.status !== undefined) return new Response("no", { status: options.status });

      return srv.upgrade(request, { data: undefined })
        ? undefined
        : new Response("upgrade", { status: 400 });
    },
    websocket: {
      message: (ws, message) => {
        if (Predicate.isString(message)) {
          seen.text.push(message);

          if (message.includes("CloseStream")) {
            ws.send(results("hello there", true));
            ws.send(JSON.stringify({ type: "Metadata", request_id: "r" }));
            ws.close(1000);
          }

          return;
        }

        seen.audio.push(message.byteLength);
        ws.send(results(`heard ${seen.audio.length}`, false));
      },
    },
  });

  return { seen, url: `ws://localhost:${server.port}/v1/listen` };
};

const pcm = (bytes: number) => new Uint8Array(bytes);

test("streams linear16 with the key in the header, then CloseStream, and folds the results", async () => {
  const { seen, url } = fakeDeepgram();
  const provider = deepgramProvider({ url });

  const exit = await Effect.runPromiseExit(
    Stream.runCollect(snapshots(provider.transcribe(KEY, Stream.make(pcm(3200), pcm(3200)))))
  );

  expect(Exit.isSuccess(exit) ? exit.value.at(-1) : exit).toMatchObject({
    finalText: "hello there",
    finished: true,
  });
  expect(seen.authorization).toBe(`Token ${Redacted.value(KEY)}`);
  expect(Object.fromEntries(seen.url.searchParams)).toMatchObject({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
  });
  expect(seen.audio).toEqual([3200, 3200]);
  expect(seen.text).toEqual([JSON.stringify({ type: "CloseStream" })]);
});

test("a refused key fails with key-rejected, other refusals with provider-failed", async () => {
  const rejected = fakeDeepgram({ status: 401 });

  const exit = await Effect.runPromiseExit(
    Stream.runCollect(deepgramProvider({ url: rejected.url }).transcribe(KEY, Stream.make(pcm(2))))
  );

  expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('"reason":"key-rejected"');
  void server?.stop(true);

  const broken = fakeDeepgram({ status: 503 });

  const other = await Effect.runPromiseExit(
    Stream.runCollect(deepgramProvider({ url: broken.url }).transcribe(KEY, Stream.make(pcm(2))))
  );

  expect(other).toEqual(
    Exit.fail(
      new VoiceError({
        reason: "provider-failed",
        message: "Deepgram refused the connection (HTTP 503)",
      })
    )
  );
});

test("a failing audio stream fails the transcription", async () => {
  const { url } = fakeDeepgram();
  const broken = new VoiceError({ reason: "audio-failed", message: "the blob timed out" });

  const exit = await Effect.runPromiseExit(
    Stream.runCollect(
      deepgramProvider({ url }).transcribe(
        KEY,
        Stream.concat(Stream.make(pcm(2)), Stream.fail(broken))
      )
    )
  );

  expect(exit).toEqual(Exit.fail(broken));
});

const smokeKey = process.env.POLARIS_DEEPGRAM_SMOKE_KEY;

test.skipIf(smokeKey === undefined || process.platform !== "darwin")(
  "real Deepgram transcribes speech from say",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "pl-dg-"));

    try {
      const wav = join(dir, "speech.wav");

      const said = Bun.spawnSync([
        "/usr/bin/say",
        "-o",
        wav,
        "--data-format=LEI16@16000",
        "Polaris, run the tests.",
      ]);

      expect(said.exitCode).toBe(0);
      // The WAV header is 44 bytes or more; Deepgram ignores a few stray samples.
      const audio = readFileSync(wav).subarray(44);

      const chunks = Array.from({ length: Math.ceil(audio.length / 3200) }, (_, i) =>
        audio.subarray(i * 3200, (i + 1) * 3200)
      );

      const exit = await Effect.runPromiseExit(
        Stream.runCollect(
          snapshots(
            deepgramProvider().transcribe(
              Redacted.make(smokeKey ?? ""),
              Stream.fromIterable(chunks)
            )
          )
        )
      );

      expect(Exit.isSuccess(exit) ? exit.value.at(-1)?.finalText.toLowerCase() : exit).toContain(
        "tests"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000
);

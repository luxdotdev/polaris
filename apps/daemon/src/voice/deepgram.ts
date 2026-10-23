/**
 * Deepgram's streaming API as a `VoiceProvider`: raw linear16 at 16 kHz over
 * `wss://api.deepgram.com/v1/listen`, the key in the `Authorization` header,
 * `CloseStream` once the audio ends, `KeepAlive` while it pauses.
 */
import { VOICE_SAMPLE_RATE, VoiceError } from "@polaris/protocol";
import {
  Cause,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Predicate,
  Queue,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { type ProviderResult, providerFailed, VoiceProvider } from "./provider.ts";

export const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";

/** Deepgram closes a stream that has had no audio for about 10 s. */
const KEEP_ALIVE_EVERY = Duration.seconds(4);

const listenUrl = (base: string) => {
  const url = new URL(base);
  url.search = new URLSearchParams({
    encoding: "linear16",
    sample_rate: String(VOICE_SAMPLE_RATE),
    channels: "1",
    interim_results: "true",
    punctuate: "true",
    smart_format: "true",
  }).toString();

  return url.toString();
};

const DeepgramMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("Results"),
    is_final: Schema.optionalKey(Schema.Boolean),
    channel: Schema.Struct({
      alternatives: Schema.Array(Schema.Struct({ transcript: Schema.String })),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("Error"),
    description: Schema.String,
  }),
]);

type DeepgramMessage = typeof DeepgramMessage.Type;

const decodeMessage = Schema.decodeUnknownOption(Schema.fromJsonString(DeepgramMessage));

/** Bun names the handshake's HTTP status in the error: `Expected 101 status code: 401`. */
const handshakeStatus = (message: string) => {
  const match = /status code: (\d{3})/.exec(message);

  return match === null ? null : Number(match[1]);
};

const connectFailed = (message: string) => {
  const status = handshakeStatus(message);

  return status === 401 || status === 403
    ? new VoiceError({
        reason: "key-rejected",
        message:
          "Deepgram refused the voice key. Set a valid key in Settings or with `polaris voice key set`.",
      })
    : providerFailed(
        status === null
          ? "Could not reach Deepgram from this Host"
          : `Deepgram refused the connection (HTTP ${status})`
      );
};

const errorMessage = (event: Event) =>
  Predicate.hasProperty(event, "message") && Predicate.isString(event.message) ? event.message : "";

type Results = Queue.Queue<ProviderResult, VoiceError | Cause.Done>;

const fail = (queue: Results, error: VoiceError) => {
  Queue.failCauseUnsafe(queue, Cause.fail(error));
};

/** What Deepgram said; binary or undecodable messages are skipped. */
const onMessage = (queue: Results, message: Option.Option<DeepgramMessage>) => {
  if (Option.isNone(message)) return;
  const value = message.value;

  if (value.type === "Error") {
    fail(queue, providerFailed(`Deepgram: ${value.description}`));

    return;
  }

  const text = value.channel.alternatives[0]?.transcript ?? "";

  // An empty interim result says nothing; an empty final one still clears the guess.
  if (text === "" && value.is_final !== true) return;

  Queue.offerUnsafe(queue, { text, isFinal: value.is_final === true });
};

/** Sends the audio, then `CloseStream`; `KeepAlive` whenever no audio went for a while. */
const pump = (socket: WebSocket, audio: Stream.Stream<Uint8Array, VoiceError>) =>
  Effect.gen(function* () {
    let lastSent = Date.now();

    const send = (data: string | Uint8Array) =>
      Effect.sync(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(data);
      });

    const keepAlive = Effect.suspend(() =>
      Date.now() - lastSent >= Duration.toMillis(KEEP_ALIVE_EVERY)
        ? send(JSON.stringify({ type: "KeepAlive" }))
        : Effect.void
    ).pipe(Effect.repeat(Schedule.spaced(KEEP_ALIVE_EVERY)));

    yield* Effect.forkScoped(keepAlive);
    yield* Stream.runForEach(audio, (chunk) =>
      Effect.tap(send(chunk), () =>
        Effect.sync(() => {
          lastSent = Date.now();
        })
      )
    );
    yield* send(JSON.stringify({ type: "CloseStream" }));
  });

export const deepgramProvider = (options: { readonly url?: string } = {}) =>
  VoiceProvider.of({
    kind: "deepgram",
    transcribe: (key, audio) =>
      Stream.callback<ProviderResult, VoiceError>((queue) =>
        Effect.gen(function* () {
          const opened = yield* Deferred.make<void, VoiceError>();

          const socket = yield* Effect.acquireRelease(
            Effect.sync(() => {
              const ws = new WebSocket(listenUrl(options.url ?? DEEPGRAM_URL), {
                headers: { Authorization: `Token ${Redacted.value(key)}` },
              });

              ws.binaryType = "arraybuffer";
              ws.onopen = () => Deferred.doneUnsafe(opened, Effect.void);
              ws.onerror = (event) => {
                const error = connectFailed(errorMessage(event));

                Deferred.doneUnsafe(opened, Effect.fail(error));
                fail(queue, error);
              };

              ws.onmessage = (event) => onMessage(queue, decodeMessage(event.data));
              ws.onclose = (event) => {
                if (event.code === 1000) Queue.endUnsafe(queue);
                else fail(queue, providerFailed(`Deepgram closed the stream (${event.code})`));
              };

              return ws;
            }),
            (ws) => Effect.sync(() => ws.close())
          );

          yield* Deferred.await(opened);
          yield* pump(socket, audio).pipe(
            Effect.catch((error) => Effect.sync(() => fail(queue, error))),
            Effect.forkScoped
          );
        }).pipe(Effect.catch((error) => Effect.sync(() => fail(queue, error))))
      ),
  });

export const DeepgramLive = Layer.succeed(VoiceProvider)(deepgramProvider());

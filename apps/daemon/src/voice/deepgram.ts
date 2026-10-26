/**
 * Deepgram's streaming API as a `VoiceProvider`: raw linear16 at 16 kHz over
 * `wss://api.deepgram.com/v1/listen`, the key in the `Authorization` header,
 * `CloseStream` once the audio ends, `KeepAlive` while it pauses.
 */
import { VOICE_SAMPLE_RATE, VoiceError } from "@polaris/protocol";
import {
  Cause,
  Deferred,
  Effect,
  Layer,
  Option,
  Predicate,
  Queue,
  Redacted,
  Schema,
  Stream,
} from "effect";
import { type ProviderResult, providerFailed, VoiceProvider } from "./provider.ts";
import { pump } from "./socket.ts";

export const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";

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
    fail(queue, providerFailed("Deepgram failed to transcribe the audio"));

    return;
  }

  const text = value.channel.alternatives[0]?.transcript ?? "";

  // An empty interim result says nothing; an empty final one still clears the guess.
  if (text === "" && value.is_final !== true) return;

  if (!Queue.offerUnsafe(queue, { text, isFinal: value.is_final === true }))
    fail(queue, providerFailed("Deepgram results exceeded the transcript buffer"));
};

export const deepgramProvider = (
  options: {
    readonly url?: string;
    readonly connectTimeoutMs?: number;
    readonly finishTimeoutMs?: number;
  } = {}
) =>
  VoiceProvider.of({
    kind: "deepgram",
    transcribe: (key, audio) =>
      Stream.callback<ProviderResult, VoiceError>(
        (queue) =>
          Effect.gen(function* () {
            const opened = yield* Deferred.make<void, VoiceError>();
            let audioEnded = false;

            const socket = yield* Effect.acquireRelease(
              Effect.try({
                try: () => {
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
                    if (event.code === 1000 && audioEnded) Queue.endUnsafe(queue);
                    else fail(queue, providerFailed(`Deepgram closed the stream (${event.code})`));
                  };

                  return ws;
                },
                catch: () => providerFailed("Could not open the Deepgram connection"),
              }),
              (ws) => Effect.sync(() => ws.close())
            );

            yield* Deferred.await(opened).pipe(
              Effect.timeoutOrElse({
                duration: options.connectTimeoutMs ?? 10_000,
                orElse: () =>
                  Effect.fail(providerFailed("Deepgram did not open the connection in time")),
              })
            );
            yield* pump(socket, audio).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  audioEnded = true;
                })
              ),
              Effect.andThen(Effect.sleep(options.finishTimeoutMs ?? 10_000)),
              Effect.andThen(
                Effect.sync(() =>
                  fail(queue, providerFailed("Deepgram did not finish the transcript in time"))
                )
              ),
              Effect.catch((error) => Effect.sync(() => fail(queue, error))),
              Effect.forkScoped
            );
          }).pipe(Effect.catch((error) => Effect.sync(() => fail(queue, error)))),
        { bufferSize: 64 }
      ),
  });

export const DeepgramLive = Layer.succeed(VoiceProvider)(deepgramProvider());

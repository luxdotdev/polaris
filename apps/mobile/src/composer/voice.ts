/**
 * Dictation into a composer through the Host (ADR 0077), outside React: microphone PCM goes up
 * as a Wire blob named by `voice.transcribe`, and what the Host hears comes back as snapshots.
 */
import type { VoiceTranscript } from "@polaris/protocol";
import { Cause, Effect, Exit, Fiber, Queue, Stream } from "effect";
import type { HostConnection } from "../runtime/hostConnection.ts";

export type Heard = Pick<VoiceTranscript, "finalText" | "interimText">;

/** The field while dictating: what was typed first, then what has been heard so far. */
export const withHeard = (typed: string, heard: Heard): string => {
  const words = [heard.finalText, heard.interimText].filter((part) => part !== "").join(" ");

  if (words === "") return typed;

  const before = typed.trimEnd();

  return before === "" ? words : `${before} ${words}`;
};

/** A failure's words for the composer's one caption line; a VoiceError says what to do. */
export const voiceFailure = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);

  if (error instanceof Error && error.message !== "") return error.message;

  return "Couldn't hear that. Try again.";
};

export interface Dictation {
  /** One buffer of 16 kHz s16le mono PCM. */
  readonly push: (pcm: Uint8Array) => void;
  /** Ends the audio: the Host sends what it heard last, then the dictation ends. */
  readonly finish: () => void;
  /** Stops without waiting for the last words. */
  readonly cancel: () => void;
}

export interface DictationCallbacks {
  readonly heard: (heard: Heard) => void;
  /** Once, when the dictation is over: null when it ended cleanly. */
  readonly ended: (failure: string | null) => void;
}

/** Starts a dictation on the Host's live connection; it fails at once when there is none. */
export const startDictation = (
  connection: HostConnection,
  callbacks: DictationCallbacks
): Dictation => {
  const audio = Effect.runSync(Queue.unbounded<Uint8Array, Cause.Done>());
  const live = connection.live();

  const transcribe = Effect.gen(function* () {
    if (live === null) return yield* Effect.fail(new Error(`${connection.name} isn't connected`));
    const blob = yield* live.blobs.offer(Stream.fromQueue(audio));

    yield* live.client["voice.transcribe"]({ audio: blob }).pipe(
      Stream.runForEach((heard) => Effect.sync(() => callbacks.heard(heard)))
    );
  });

  const fiber = Effect.runFork(transcribe);

  fiber.addObserver((exit) => {
    Queue.shutdownUnsafe(audio);
    callbacks.ended(
      Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? null : voiceFailure(exit.cause)
    );
  });

  return {
    push: (pcm) => {
      if (pcm.byteLength > 0) Queue.offerUnsafe(audio, pcm);
    },
    finish: () => {
      Queue.endUnsafe(audio);
    },
    cancel: () => {
      Queue.shutdownUnsafe(audio);
      Effect.runFork(Fiber.interrupt(fiber));
    },
  };
};

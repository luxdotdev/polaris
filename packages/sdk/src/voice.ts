/**
 * `transcribe`: microphone audio to text through the Host (ADR 0077). The
 * audio goes up as a Wire blob, offered before `voice.transcribe` names it;
 * snapshots come back until the audio ends.
 */
import type { VoiceError, VoiceTranscript } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { ConnectError } from "./connection.ts";
import { HostUnreachable } from "./errors.ts";
import type { HostLink } from "./link.ts";
import type { NotFound, NotGranted } from "./errors.ts";

export { VOICE_SAMPLE_RATE } from "@polaris/protocol";

/** What has been heard so far: `finalText` is settled, `interimText` may still change. */
export type Transcript = Pick<VoiceTranscript, "finalText" | "interimText" | "finished">;

export type TranscribeError = ConnectError | NotGranted | NotFound | VoiceError;

export const transcribeOn = <E>(
  link: HostLink,
  audio: Stream.Stream<Uint8Array, E>
): Stream.Stream<Transcript, TranscribeError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const live = yield* link.live;
      const blob = yield* live.blobs.offer(audio);

      return live.client["voice.transcribe"]({ audio: blob }).pipe(
        Stream.map(({ finalText, interimText, finished }) => ({
          finalText,
          interimText,
          finished,
        })),
        Stream.catchTag("RpcClientError", (error) =>
          Stream.fail(new HostUnreachable({ hostId: link.entry.hostId, detail: error.message }))
        )
      );
    })
  ).pipe(Stream.interruptWhen(link.closed));

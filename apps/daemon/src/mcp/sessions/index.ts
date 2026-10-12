/**
 * What the session tools read from the owning Daemon: another session's Turns
 * (`read_worker`) and a session's background commands (`wait_for_command`).
 */
import type { SessionId } from "@polaris/protocol";
import { Effect } from "effect";
import type { EventStore } from "../../store/EventStore.ts";
import type { ServiceError } from "../../services.ts";
import { readTranscript } from "./read.ts";
import { WaitOutcome, waitForCommand } from "./wait.ts";

export { TRANSCRIPT_LIMIT, transcriptText } from "./transcript.ts";

export { WaitOutcome } from "./wait.ts";

export interface TranscriptOptions {
  /** How many of the latest Turns. */
  readonly turns: number;
  /** Only Turns from this one-based number on; null for the latest. */
  readonly since: number | null;
}

export interface WaitOptions {
  /** A background task id; null waits for every background command. */
  readonly task: string | null;
  readonly timeoutMs: number;
}

export interface SessionTools {
  /** The session's Turns as text; null when this Daemon doesn't hold the session. */
  readonly transcript: (
    sessionId: SessionId,
    options: TranscriptOptions
  ) => Effect.Effect<string | null, ServiceError>;
  readonly waitForCommand: (
    sessionId: SessionId,
    options: WaitOptions
  ) => Effect.Effect<WaitOutcome>;
}

export const unavailableSessions: SessionTools = {
  transcript: () => Effect.succeed(null),
  waitForCommand: () => Effect.succeed(WaitOutcome.Unavailable()),
};

/** The Daemon's session tools, over its EventStore. */
export const sessionTools = (store: EventStore["Service"]): SessionTools => ({
  transcript: (sessionId, options) => readTranscript(store, sessionId, options),
  waitForCommand: (sessionId, options) => waitForCommand(store, sessionId, options),
});

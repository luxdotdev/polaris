/** `request_secret` (ADR 0089): the agent asks the user for a secret and gets a file path. */
import {
  SECRET_REQUEST_DEFAULT_TIMEOUT_MS,
  SECRET_REQUEST_MAX_TIMEOUT_MS,
  type SessionId,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { SecretOutcome } from "../../secrets/requests.ts";
import type { SessionTools } from "../sessions/index.ts";
import { sessionTool, text } from "./session.ts";
import { rejection } from "./shared.ts";

const MAX_SECONDS = SECRET_REQUEST_MAX_TIMEOUT_MS / 1000;

const DEFAULT_SECONDS = SECRET_REQUEST_DEFAULT_TIMEOUT_MS / 1000;

const RequestSecretInput = Schema.Struct({
  label: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(600)),
  placeholder: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(80))),
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: MAX_SECONDS }))
  ),
  /** Only `file` for now; refs Polaris's own tools resolve may follow. */
  delivery: Schema.optionalKey(Schema.Literal("file")),
});

const minutes = (seconds: number) =>
  seconds < 120 ? `${seconds} seconds` : `${Math.round(seconds / 60)} minutes`;

const outcomeText = (outcome: SecretOutcome, seconds: number) =>
  SecretOutcome.$match(outcome, {
    Saved: ({ file }) =>
      Effect.succeed(
        text([
          `Saved. The secret is in ${file}, readable by your commands for 24 hours.`,
          `Use it as "$(cat ${file})" inside a command. Never print, echo, log or commit it, and don't copy the file.`,
        ])
      ),
    Declined: () =>
      Effect.succeed(
        text([
          "The user declined.",
          "Carry on without it. Don't ask again unless the user says so.",
        ])
      ),
    TimedOut: () =>
      Effect.succeed(
        text([
          `No answer in ${minutes(seconds)}; the request was withdrawn.`,
          "Do the work that doesn't need the secret. If you're blocked, end your Turn and say what you need.",
        ])
      ),
    Cancelled: ({ reason }) =>
      Effect.succeed(text([`The request ended unanswered: ${reason}.`, "Nothing was saved."])),
    NoTurn: () =>
      Effect.fail(
        rejection(
          "E-NO-TURN",
          "This session has no Turn in flight to ask on",
          "Ask while you're working on a Turn."
        )
      ),
    NotFound: () =>
      Effect.fail(
        rejection("E-SESSION", "This session can't ask for secrets", "Continue without it.")
      ),
  });

/** Every binding: a private card on the user's desktop and phone, waited on. */
export const requestSecretTool = (sessionId: SessionId, sessions: SessionTools) =>
  sessionTool(
    "request_secret",
    `Ask the user for a secret (an API key, auth token or password) in a private card, and wait for the answer. You never see the value: you get the path of a file only your commands read, for 24 hours. Never ask for a secret in chat, and never invent one. Before asking, do the work that doesn't need it. label is the card's title; reason says what it's for and exactly where to get it. Waits up to timeoutSeconds (default ${DEFAULT_SECONDS}, at most ${MAX_SECONDS}).`,
    RequestSecretInput,
    (input) => {
      const seconds = input.timeoutSeconds ?? DEFAULT_SECONDS;

      return sessions
        .requestSecret(sessionId, {
          label: input.label,
          reason: input.reason,
          placeholder: input.placeholder ?? null,
          timeoutMs: seconds * 1000,
        })
        .pipe(
          Effect.mapError(() =>
            rejection("E-SECRET", "The request couldn't be recorded", "Try again.")
          ),
          Effect.flatMap((outcome) => outcomeText(outcome, seconds))
        );
    }
  );

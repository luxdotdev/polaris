/** `origins` (ADR 0111): the Agent Sessions and Turns on this Host that wrote some lines or a commit. */
import type { SessionId } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { OriginsOutcome, type OriginsQuery, type SessionTools } from "../sessions/index.ts";
import { rejection, type BoundTool } from "./shared.ts";
import { sessionTool, text } from "./session.ts";

const DESCRIPTION =
  'Find out why code was written: the Agent Sessions on this Host whose Turns wrote these lines or this commit, with each Turn\'s prompt and final reply. Reach for it before changing code you don\'t understand, or when a line looks odd and you want the request behind it. Give path (relative to your checkout) with lines like "10-24" (default: the whole file), or commit (a sha). It answers each line\'s git commit (or "not committed") and every session and Turn that wrote them; open a Turn in full with read_history and its turn id. Lines a person wrote, or a session on another Host, have no Origin.';

const Input = Schema.Struct({
  path: Schema.optionalKey(Schema.NonEmptyString),
  lines: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^\s*\d+\s*(?:-\s*\d+\s*)?$/))),
  commit: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[0-9a-f]{4,64}$/i))),
});

const badInput = rejection(
  "E-INPUT",
  "Give either path (with optional lines) or commit",
  'Call origins with { "path": "src/a.ts", "lines": "10-24" } or { "commit": "1a2b3c4" }.'
);

const badRange = rejection(
  "E-INPUT",
  "lines must be a range from 1, start before end",
  'Use lines like "10-24", or "12" for one line.'
);

/** The input as a lookup, or the rejection that says what to fix. */
const queryOf = (input: typeof Input.Type) => {
  if ((input.path === undefined) === (input.commit === undefined)) return Effect.fail(badInput);

  if (input.commit !== undefined)
    return input.lines === undefined
      ? Effect.succeed<OriginsQuery>({ commit: input.commit })
      : Effect.fail(badInput);

  const path = input.path ?? "";

  if (input.lines === undefined) return Effect.succeed<OriginsQuery>({ path, lines: null });

  const [start = 0, end = start] = input.lines.split("-").map((part) => Number(part.trim()));

  return start >= 1 && end >= start
    ? Effect.succeed<OriginsQuery>({ path, lines: { start, end } })
    : Effect.fail(badRange);
};

const answer = (outcome: OriginsOutcome) =>
  OriginsOutcome.$match(outcome, {
    Text: ({ text: body }) => Effect.succeed(text([body])),
    NoCaller: () =>
      Effect.fail(
        rejection("E-SESSION", "This session isn't on this Host", "Continue without origins.")
      ),
    Missing: ({ what, id }) =>
      Effect.fail(
        rejection(
          "E-NOT-FOUND",
          `No ${what} "${id}"`,
          what === "file"
            ? "Give a path to a file inside your checkout, relative to it."
            : "Check the commit id with git log."
        )
      ),
    GitFailed: ({ message }) =>
      Effect.fail(
        rejection("E-GIT", `git couldn't answer: ${message}`, "Check the path or commit with git.")
      ),
  });

export const originsTool = (caller: SessionId, sessions: SessionTools): BoundTool => ({
  ...sessionTool("origins", DESCRIPTION, Input, (input) =>
    Effect.gen(function* () {
      const query = yield* queryOf(input);

      if (sessions.origins === undefined)
        return yield* rejection(
          "E-NOT-READY",
          "Origins aren't running on this Host",
          "Continue without origins; git log and git blame still work."
        );

      return yield* sessions.origins.lookup(caller, query).pipe(
        Effect.mapError(() =>
          rejection("E-READ", "Origins couldn't be read", "Try again shortly.")
        ),
        Effect.flatMap(answer)
      );
    })
  ),
  annotations: { readOnlyHint: true },
});

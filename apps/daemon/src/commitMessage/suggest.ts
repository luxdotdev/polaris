/**
 * `commit.suggestMessage`: read the index on the Host, refuse before spawning a
 * Harness when there's nothing to describe, then stream one structured message.
 */
import {
  CommitMessageError,
  CommitMessageStreamItem,
  harnessEntry,
  type CommitMessageErrorReason,
  type CommitMessageRequest,
  type HarnessStatus,
} from "@polaris/protocol";
import { Effect, Match, Queue, Stream } from "effect";
import { Availability } from "../harness/availability/Availability.ts";
import type { MessageBackend } from "./backend.ts";
import { commitPrompt, instructions, messageJsonSchema, tidy } from "./prompt.ts";
import { DIFF_BUDGET, readStaged } from "./staged.ts";

/** A Harness that hangs is cut off; the Client can always cancel sooner. */
export const SUGGEST_TIMEOUT = "120 seconds";

const fail = (reason: CommitMessageErrorReason, message: string) =>
  new CommitMessageError({ reason, message });

const nameOf = (harness: CommitMessageRequest["harness"]) => harnessEntry(harness)?.name ?? harness;

const statusOf = (harness: CommitMessageRequest["harness"], refresh: boolean) =>
  Effect.gen(function* () {
    const report = yield* (yield* Availability).get(refresh);

    return report.harnesses.find((entry) => entry.harness === harness)?.status ?? "unknown";
  });

/** Not installed or not signed in, as the actionable reasons; null when it may work. */
const unavailable = (harness: CommitMessageRequest["harness"], status: HarnessStatus) =>
  Match.value(status).pipe(
    Match.when("not-installed", () =>
      fail("harness-missing", `${nameOf(harness)} isn't installed on this Host`)
    ),
    Match.when("outdated", () =>
      fail("harness-missing", `${nameOf(harness)} on this Host is too old to draft messages`)
    ),
    Match.when("needs-sign-in", () =>
      fail("needs-sign-in", `${nameOf(harness)} isn't signed in on this Host`)
    ),
    Match.orElse(() => null)
  );

const draft = Effect.fn("commitMessage.draft")(function* (
  request: CommitMessageRequest,
  backend: MessageBackend,
  budget: number,
  progress: (text: string) => Effect.Effect<void>
) {
  const started = performance.now();
  const staged = yield* Effect.promise(() => readStaged(request.cwd, budget));

  if (staged === "not-a-repository")
    return yield* fail("not-a-repository", "This folder isn't in a git repository");

  if (staged === "nothing-staged") return yield* fail("nothing-staged", "Nothing is staged");

  const before = unavailable(request.harness, yield* statusOf(request.harness, false));

  // A cached refusal may predate an install or sign-in, so it's checked once more.
  if (before !== null) {
    const now = unavailable(request.harness, yield* statusOf(request.harness, true));

    if (now !== null) return yield* now;
  }

  const job = {
    instructions,
    prompt: commitPrompt(staged, budget),
    schema: messageJsonSchema,
    model: request.model,
    effort: request.effort,
    read: false,
  };

  const drafted = yield* backend(request.harness, job, staged.top, progress).pipe(
    Effect.timeoutOrElse({
      duration: SUGGEST_TIMEOUT,
      orElse: () => Effect.fail(fail("timed-out", `${nameOf(request.harness)} took too long`)),
    }),
    Effect.catchTag("HarnessError", (error) =>
      statusOf(request.harness, true).pipe(
        Effect.flatMap((status) =>
          Effect.fail(unavailable(request.harness, status) ?? fail("harness-failed", error.message))
        )
      )
    )
  );

  const message = tidy(drafted);

  if (message.subject === "")
    return yield* fail("invalid-message", "The Harness returned an empty subject");

  return CommitMessageStreamItem.cases.Suggested.make({
    message,
    truncated: staged.omitted > 0,
    thoughtMs: Math.max(0, Math.round(performance.now() - started)),
  });
});

export const suggest = (
  request: CommitMessageRequest,
  backend: MessageBackend,
  budget: number = DIFF_BUDGET
) =>
  Stream.callback<CommitMessageStreamItem, CommitMessageError, Availability>(
    (queue) =>
      Effect.gen(function* () {
        const progress = (text: string) =>
          Queue.offer(queue, CommitMessageStreamItem.cases.Delta.make({ text })).pipe(
            Effect.asVoid
          );

        const run = draft(request, backend, budget, progress).pipe(
          Effect.flatMap((item) => Queue.offer(queue, item)),
          Effect.matchCauseEffect({
            onFailure: (cause) => Queue.failCause(queue, cause),
            onSuccess: () => Queue.end(queue),
          })
        );

        yield* Effect.forkScoped(run);
      }),
    { bufferSize: 32 }
  );

export const handleSuggest = (request: CommitMessageRequest) =>
  Stream.unwrap(
    Effect.promise(async () =>
      process.env.POLARIS_BENCH_HARNESS === "1"
        ? (await import("./bench.ts")).benchMessage
        : (await import("./live.ts")).liveMessage
    ).pipe(Effect.map((backend) => suggest(request, backend)))
  );

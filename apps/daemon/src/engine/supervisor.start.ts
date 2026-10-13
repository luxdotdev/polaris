/**
 * Opening a Harness for a Turn: one that never reports back, or that crashes
 * the open, fails the start with a line naming the Harness and the Host.
 */
import { type HarnessKind, harnessEntry } from "@polaris/protocol";
import { Duration, Effect, Inspectable } from "effect";
import { HarnessError } from "../harness/HarnessDriver.ts";

/** How long a Harness may take to open before its session Fails; EngineSettings can change it. */
export const DEFAULT_HARNESS_START_TIMEOUT = Duration.seconds(90);

const nameOf = (harness: HarnessKind) => harnessEntry(harness)?.name ?? harness;

const commandOf = (harness: HarnessKind) =>
  harnessEntry(harness)?.setup.signInCommand[0] ?? harness;

export const startTimedOut = (harness: HarnessKind, after: Duration.Input, host: string) =>
  new HarnessError({
    harness,
    message: `${nameOf(harness)} didn't start on ${host} after ${Math.round(Duration.toSeconds(after))} seconds. Check that \`${commandOf(harness)} --version\` runs there, then retry.`,
  });

/** The open, failed with `startTimedOut` if it takes longer than `after`, and with its defect's message if it dies. */
export const timedStart = <A, E, R>(
  open: Effect.Effect<A, E, R>,
  harness: HarnessKind,
  after: Duration.Input,
  host: string
): Effect.Effect<A, E | HarnessError, R> =>
  open.pipe(
    Effect.catchDefect((defect) =>
      Effect.fail(
        new HarnessError({
          harness,
          message: `${nameOf(harness)} couldn't start on ${host}: ${
            defect instanceof Error ? defect.message : Inspectable.toStringUnknown(defect)
          }`,
          cause: defect,
        })
      )
    ),
    Effect.timeoutOrElse({
      duration: after,
      orElse: () => Effect.fail(startTimedOut(harness, after, host)),
    })
  );

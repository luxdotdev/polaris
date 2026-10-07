import { expect } from "bun:test";
import { Effect, Predicate, Stream } from "effect";
import type { DaemonClient } from "@polaris/client";
import * as P from "@polaris/protocol";

const logBacklog = (client: DaemonClient, context: P.LanguageContextIdentity) =>
  client["languages.log.watch"]({ context }).pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.map((items) => {
      const first = items[0];

      if (first === undefined || !Predicate.isTagged(first, "Snapshot"))
        throw new Error("Missing log backlog");

      return first.lines;
    }),
    Effect.timeout("10 seconds")
  );

const ready = (
  client: DaemonClient,
  input: typeof P.AcquireLanguageContext.payloadSchema.Type,
  previousGeneration: number
) =>
  Effect.gen(function* () {
    for (let i = 0; i < 300; i++) {
      const snapshot = yield* client["languages.context.acquire"](input);

      if (
        snapshot.context.generation > previousGeneration &&
        Predicate.isTagged(snapshot.runtime, "Ready")
      )
        return snapshot;
      yield* Effect.sleep("20 millis");
    }

    throw new Error("Restart readiness deadline");
  });

/** Exercises the actual authenticated default handler graph over its Unix socket. */
export const exerciseLogFormat = Effect.fn("LiveLogFormat")(function* (
  client: DaemonClient,
  input: typeof P.AcquireLanguageContext.payloadSchema.Type,
  initial: typeof P.LanguageContextSnapshot.Type,
  uri: string
) {
  let current = initial;

  const lines = yield* logBacklog(client, current.context);

  expect(
    lines.some((line) => line.source === "logMessage" && line.text.includes("Typescript version"))
  ).toBe(true);

  const pidLine = lines.find(
    (line) => line.source === "stderr" && line.text.startsWith("slice-4d-pid:")
  );

  if (pidLine === undefined) throw new Error("Missing owned process PID");

  const pid = Number(pidLine.text.slice("slice-4d-pid:".length));

  expect(Number.isSafeInteger(pid)).toBe(true);

  const originalGeneration = current.context.generation;
  yield* Effect.sync(() => process.kill(pid, "SIGKILL"));
  current = yield* ready(client, input, originalGeneration);

  expect(current.context.generation).toBeGreaterThan(originalGeneration);

  const restarted = yield* logBacklog(client, current.context);

  expect(
    restarted.some(
      (line) => line.source === "logMessage" && line.text.includes("Typescript version")
    )
  ).toBe(true);

  expect(restarted[0]?.sequence).toBe(1);

  const draft = "function badly(){\nreturn 1\n}\n";

  const ack = yield* client["languages.document.sync"]({
    context: current.context,
    sequence: current.ack.acceptedSequence + 1,
    notification: P.LanguageDocumentNotification.cases.Change.make({
      uri,
      previousVersion: 1,
      version: 2,
      changes: [{ text: draft }],
    }),
  });

  const request = P.LanguageFormatPreflight.make({
    requestId: "live-format",
    fence: {
      context: current.context,
      requiredSequence: ack.acceptedSequence,
      documents: ack.documents,
    },
    document: { uri, version: 2 },
    snapshot: draft,
    expectedDiskVersion: { mtimeMs: 0, size: 16, hash: "a".repeat(64) },
    formatter: P.LanguageFormatterSelection.cases.Provider.make({ providerId: input.providerId }),
    options: { tabSize: 2, insertSpaces: true },
    reason: "manual",
    deadline: Date.now() + 10000,
  });

  const formatted = yield* client["languages.format"](request);

  expect(Predicate.isTagged(formatted, "Formatted")).toBe(true);

  if (!Predicate.isTagged(formatted, "Formatted")) throw new Error("Real formatting failed");

  expect(formatted.edits.length).toBeGreaterThan(0);

  expect(formatted.fence).toEqual(request.fence);

  expect(formatted.document).toEqual(request.document);

  expect(formatted.edits.some((edit) => edit.newText.includes("  "))).toBe(true);

  return current;
});

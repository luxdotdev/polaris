import { expect, test } from "bun:test";
import { Predicate } from "effect";
import * as P from "@polaris/protocol";
import { fixture } from "./fixtures.testing.ts";

const preflight = (snapshot: typeof P.LanguageContextSnapshot.Type, uri: string) =>
  P.LanguageFormatPreflight.make({
    requestId: "format",
    fence: {
      context: snapshot.context,
      requiredSequence: snapshot.ack.acceptedSequence,
      documents: snapshot.ack.documents,
    },
    document: { uri, version: 1 },
    snapshot: "draft",
    expectedDiskVersion: { mtimeMs: 0, size: 5, hash: "a".repeat(64) },
    formatter: P.LanguageFormatterSelection.cases.Provider.make({ providerId: "fake" }),
    options: { tabSize: 2, insertSpaces: true },
    reason: "manual",
    deadline: Date.now() + 10000,
  });

test("provider formatter returns edits; snapshot, version, generation and capability are fenced", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire();
    await f.open("one", context);
    const ready = await f.ready("one", context);
    const input = preflight(ready, f.uri);
    expect(await f.broker.format("one", input)).toEqual(
      P.LanguageFormatOutcome.cases.Formatted.make({
        requestId: input.requestId,
        fence: input.fence,
        document: input.document,
        edits: [],
      })
    );

    const range = await f.broker.request(
      "one",
      P.LanguageFeatureRequest.make({
        requestId: "range",
        fence: input.fence,
        method: "textDocument/rangeFormatting",
        params: {
          textDocument: { uri: f.uri },
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          options: input.options,
        },
        deadline: input.deadline,
      })
    );

    expect(range.result).toEqual([]);
    expect(await f.broker.format("one", { ...input, snapshot: "forged" })).toMatchObject({
      reason: "stale",
    });
    expect(
      await f.broker.format("one", {
        ...input,
        formatter: P.LanguageFormatterSelection.cases.Provider.make({ providerId: "other" }),
      })
    ).toMatchObject({ reason: "unavailable" });
    expect(
      await f.broker.format("one", {
        ...input,
        formatter: P.LanguageFormatterSelection.cases.None.make({}),
      })
    ).toEqual(
      P.LanguageFormatOutcome.cases.Skipped.make({
        requestId: input.requestId,
        reason: "no-formatter",
      })
    );
    await f.broker.sync("one", {
      context,
      sequence: 2,
      notification: P.LanguageDocumentNotification.cases.Change.make({
        uri: f.uri,
        previousVersion: 1,
        version: 2,
        changes: [{ text: "new" }],
      }),
    });
    expect(await f.broker.format("one", input)).toMatchObject({ reason: "stale" });
    await Promise.resolve(
      expect(f.broker.format("two", input)).rejects.toMatchObject({ reason: "not-owner" })
    );
    await f.broker.restart("one", context);
    await Promise.resolve(
      expect(f.broker.format("one", input)).rejects.toMatchObject({
        reason: "stale-generation",
      })
    );
  } finally {
    await f.dispose();
  }
});

test("unsupported formatting never dispatches and typing cancels a pending format", async () => {
  for (const mode of ["no-format", "slow-format"]) {
    const f = await fixture(mode);

    try {
      const { context } = await f.acquire();
      await f.open("one", context);
      const ready = await f.ready("one", context);
      const input = preflight(ready, f.uri);
      const pending = f.broker.format("one", input);

      if (mode === "no-format") {
        expect(await pending).toMatchObject({ reason: "unavailable" });
        continue;
      }

      await Bun.sleep(15);
      await f.broker.sync("one", {
        context,
        sequence: 2,
        notification: P.LanguageDocumentNotification.cases.Change.make({
          uri: f.uri,
          previousVersion: 1,
          version: 2,
          changes: [{ text: "typed" }],
        }),
      });
      expect(Predicate.isTagged(await pending, "Failed")).toBe(true);
    } finally {
      await f.dispose();
    }
  }
});

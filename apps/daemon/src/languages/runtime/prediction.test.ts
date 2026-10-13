import { expect, test } from "bun:test";
import { LanguageDocumentNotification } from "@polaris/protocol";
import { fixture } from "./fixtures.testing.ts";

test("prediction lookup never starts a server and requires the requesting Client's exact synchronized draft", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire("one");
    expect(f.broker.predictionDocument("one", f.checkout, f.uri, "draft")).toBeUndefined();
    expect(f.processes).toHaveLength(0);
    await f.open("one", context);
    await f.ready("one", context);
    expect(f.broker.predictionDocument("two", f.checkout, f.uri, "draft")).toBeUndefined();
    expect(f.broker.predictionDocument("one", f.checkout, f.uri, "different")).toBeUndefined();
    const found = f.broker.predictionDocument("one", f.checkout, f.uri, "draft");
    expect(found?.fence.documents).toEqual([{ uri: f.uri, version: 1 }]);
    await f.broker.sync("one", {
      context,
      sequence: 2,
      notification: LanguageDocumentNotification.cases.Change.make({
        uri: f.uri,
        previousVersion: 1,
        version: 2,
        changes: [{ text: "new" }],
      }),
    });
    expect(f.broker.predictionDocument("one", f.checkout, f.uri, "draft")).toBeUndefined();
    expect(
      f.broker.predictionDocument("one", f.checkout, f.uri, "new")?.fence.documents[0]?.version
    ).toBe(2);
    f.revoke();
    expect(f.broker.predictionDocument("one", f.checkout, f.uri, "new")).toBeUndefined();
    expect(f.processes).toHaveLength(1);
  } finally {
    await f.dispose();
  }
});

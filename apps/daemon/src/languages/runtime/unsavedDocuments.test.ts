import { expect, test } from "bun:test";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Schema } from "effect";
import {
  LanguageDocumentNotification,
  LanguageError,
  LanguageFeatureRequest,
} from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import { fixture } from "./fixtures.testing.ts";

const open = (uri: string, text: string) =>
  LanguageDocumentNotification.cases.Open.make({ uri, languageId: "typescript", version: 1, text });

const hover = (context: LanguageContextIdentity, uri: string, sequence: number) =>
  LanguageFeatureRequest.make({
    requestId: `hover-${sequence}`,
    fence: { context, requiredSequence: sequence, documents: [{ uri, version: 1 }] },
    method: "textDocument/hover",
    params: { textDocument: { uri } },
    deadline: Date.now() + 1000,
  });

const reason = (promise: Promise<unknown>) =>
  promise.then(
    () => "accepted",
    (error: Error) => (Schema.is(LanguageError)(error) ? error.reason : error.message)
  );

test("a document with no file on disk opens inside the checkout, and only there", async () => {
  const f = await fixture();

  try {
    const { context } = await f.acquire("one");
    const unsaved = pathToFileURL(join(f.root, "file.polaris-verify-1.ts")).href;

    const ack = await f.broker.sync("one", {
      context,
      sequence: 1,
      notification: open(unsaved, "shadow"),
    });

    expect(ack.documents).toEqual([{ uri: unsaved, version: 1 }]);
    await f.ready("one", context);
    expect((await f.broker.request("one", hover(context, unsaved, 1))).result).toHaveProperty(
      "text",
      "shadow"
    );

    const outside = pathToFileURL(join(f.root, "..", "escape.polaris-verify-2.ts")).href;
    expect(
      await reason(f.broker.sync("one", { context, sequence: 2, notification: open(outside, "x") }))
    ).toBe("invalid-input");

    await symlink(join(f.root, "..", "gone.ts"), join(f.root, "dangling.ts"));
    const dangling = pathToFileURL(join(f.root, "dangling.ts")).href;
    expect(
      await reason(
        f.broker.sync("one", { context, sequence: 2, notification: open(dangling, "x") })
      )
    ).not.toBe("accepted");

    const missingDirectory = pathToFileURL(join(f.root, "absent", "file.ts")).href;
    expect(
      await reason(
        f.broker.sync("one", { context, sequence: 2, notification: open(missingDirectory, "x") })
      )
    ).not.toBe("accepted");
  } finally {
    await f.dispose();
  }
});

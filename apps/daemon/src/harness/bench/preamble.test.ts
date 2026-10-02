import { expect, test } from "bun:test";
import { SessionId, TurnId } from "@polaris/protocol";
import { Effect } from "effect";
import { preambleProbe } from "./preamble.ts";

test("the preamble probe does not invent a tool when none is attached", async () => {
  const item = await Effect.runPromise(
    preambleProbe(
      {
        sessionId: SessionId.make("plain"),
        cwd: "/tmp",
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor: null,
      },
      TurnId.make("probe")
    )
  );

  expect(item).toMatchObject({
    text: "No start tool and workspace were supplied by the Polaris instructions.",
  });
});

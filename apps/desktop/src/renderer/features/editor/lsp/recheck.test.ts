import { rejects } from "node:assert/strict";
import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { coordinatorFixture } from "./coordinator.testing.ts";
import { statusStore } from "../status/store.ts";
import { runAction } from "../status/actions.ts";

for (const reason of ["conflict", "timeout"] as const)
  test(`Check again retries ${reason} with fresh discovery and then recovers`, async () => {
    let fail = true;

    const error = new P.LanguageError({
      reason,
      message:
        reason === "timeout"
          ? "Host installation preflight timed out"
          : "Version updates require an explicit update request",
      retryable: true,
    });

    const f = coordinatorFixture(undefined, () => (fail ? error : null));
    const file = f.open("upgrade.ts");

    try {
      for (
        let count = 0;
        count < 100 && statusStore.getState().files[file.key]?.phase !== "failed";
        count++
      )
        await new Promise((resolve) => setTimeout(resolve, 1));
      expect(statusStore.getState().files[file.key]?.failure).toEqual({
        reason: error.reason,
        message: error.message,
      });

      const retry = () =>
        runAction(
          "check-again",
          { hostKey: "reuse", path: file.path, checkout: null, providerId: null, trust: null },
          {
            api: f.service.api,
            recheck: () => f.coordinator.recheck(file.key),
            showLog: () => {},
            openSettings: () => {},
          }
        );

      await rejects(retry(), { reason, message: error.message, retryable: true });
      fail = false;
      await retry();
      await f.settled(file);
      expect(f.requests.filter((method) => method === "languages.discover")).toHaveLength(3);
      expect(
        f.requestInputs.filter((item) =>
          Schema.is(
            Schema.Struct({
              method: Schema.Literal("languages.discover"),
              input: Schema.Struct({ refresh: Schema.Literal(true) }),
            })
          )(item)
        )
      ).toHaveLength(2);
      expect(statusStore.getState().files[file.key]?.phase).toBe("discovered");
    } finally {
      f.coordinator.dispose();
    }
  });

test("Check again reports a detached file instead of silently succeeding", async () => {
  const f = coordinatorFixture();

  try {
    await rejects(f.coordinator.recheck("missing-file"), { reason: "not-ready" });
    expect(f.requests).toHaveLength(0);
  } finally {
    f.coordinator.dispose();
  }
});

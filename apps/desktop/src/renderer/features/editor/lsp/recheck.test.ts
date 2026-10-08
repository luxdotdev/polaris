import { rejects } from "node:assert/strict";
import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { coordinatorFixture } from "./coordinator.testing.ts";
import { statusStore } from "../status/store.ts";
import { runAction } from "../status/actions.ts";

test("Check again awaits a fresh discovery and reports its typed error, then recovers", async () => {
  let fail = true;

  const error = new P.LanguageError({
    reason: "conflict",
    message: "Version updates require an explicit update request",
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

    await rejects(retry(), { reason: "conflict", message: error.message });
    fail = false;
    await retry();
    await f.settled(file);
    expect(f.requests.filter((method) => method === "languages.discover")).toHaveLength(3);
    expect(statusStore.getState().files[file.key]?.phase).toBe("discovered");
  } finally {
    f.coordinator.dispose();
  }
});

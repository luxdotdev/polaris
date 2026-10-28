import { describe, expect, test } from "bun:test";
import { unregisterPush } from "./registration.ts";

describe("unregistering on unlink", () => {
  test("a Host that never answers doesn't hold the unlink past the wait", async () => {
    const started = Date.now();
    const hung = { run: () => new Promise<never>(() => {}) };
    const offline = { run: () => Promise.reject(new Error("not connected")) };

    await unregisterPush([hung, offline], 50);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

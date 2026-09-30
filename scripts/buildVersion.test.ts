import { describe, expect, test } from "bun:test";
import { buildVersion } from "./buildVersion.ts";

const commit = { count: 412, sha: "5821ca0", dirty: false };

const now = new Date("2026-09-30T17:00:00Z");

describe("buildVersion", () => {
  test("a release build is the package version as it is", () => {
    expect(buildVersion("0.3.0", { release: true, commit, now })).toBe("0.3.0");
  });

  test("a dev build names its commit, and a dirty tree when it has one", () => {
    expect(buildVersion("0.0.0", { release: false, commit, now })).toBe("0.0.0-dev.412.5821ca0");
    expect(buildVersion("0.0.0", { release: false, commit: { ...commit, dirty: true }, now })).toBe(
      "0.0.0-dev.412.5821ca0.dirty1790787600"
    );
  });
});

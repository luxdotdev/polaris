import { describe, expect, test } from "bun:test";
import { type BannerEntry, bannerFor } from "./banners.ts";

const entry = (id: string, banner: BannerEntry["banner"], sessionId = "s1"): BannerEntry => ({
  hostKey: "local",
  sessionId,
  id,
  title: "Tests pass",
  body: "Ready",
  banner,
});

describe("bannerFor", () => {
  const query = { hostKey: "local", sessionId: "s1", title: "Tests pass", body: "Ready" };

  test("the latest banner with the call's words in its session", () => {
    expect(bannerFor([entry("n1", "here"), entry("n2", "shown")], query)).toBe("shown");
    expect(bannerFor([entry("n1", "shown", "s2")], query)).toBeNull();
    expect(bannerFor([], query)).toBeNull();
  });
});

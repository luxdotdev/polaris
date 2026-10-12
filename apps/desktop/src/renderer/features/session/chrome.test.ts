import { describe, expect, test } from "bun:test";
import { polarisAuthored, type SessionChrome } from "./chrome.ts";

describe("polarisAuthored", () => {
  const chrome: SessionChrome = {
    promptCard: ({ turnId }) => (turnId === "t-digest" ? "card" : null),
    steerCard: ({ itemId }) => (itemId === "steer:digest" ? "card" : null),
  };

  test("a Turn or steer the chrome shows a card for is Polaris's", () => {
    expect(polarisAuthored(chrome, "t-digest", null)).toBe(true);
    expect(polarisAuthored(chrome, "t-user", null)).toBe(false);
    expect(polarisAuthored(chrome, "t-user", "steer:digest")).toBe(true);
    expect(polarisAuthored(chrome, "t-user", "steer:mine")).toBe(false);
  });

  test("without chrome everything is the user's", () => {
    expect(polarisAuthored({}, "t-digest", null)).toBe(false);
    expect(polarisAuthored({}, "t-digest", "steer:digest")).toBe(false);
  });
});

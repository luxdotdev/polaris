import { describe, expect, test } from "bun:test";
import { hostModel } from "../../../routes/fixtures.testing.ts";
import type { SessionEntry } from "../../../store/hostModel.ts";
import { SessionId } from "@polaris/protocol";
import type { SessionData } from "../../../store/plain.ts";
import { isReviewSession, reviewsOpen, sectionsOf } from "./sections.ts";

const base = [
  ...hostModel([{ id: "w", sessions: [{ id: "x", state: "idle" }] }]).sessions.values(),
][0]!;

const entry = (id: string, fields: Partial<SessionData> = {}): SessionEntry => ({
  ...base,
  session: { ...base.session, id: SessionId.make(id), title: id, ...fields },
});

const ids = (entries: ReadonlyArray<SessionEntry>) => entries.map((e) => `${e.session.id}`);

describe("sectionsOf", () => {
  const rows = [
    entry("needs", { state: "needs-you" }),
    entry("late-pin", { pinnedAt: "2026-10-12T02:00:00.000Z" }),
    entry("review", { origin: "reviewer" }),
    entry("plain"),
    entry("early-pin", { pinnedAt: "2026-10-12T01:00:00.000Z", state: "needs-you" }),
    entry("old-walkthrough", { title: "Walkthrough · #212" }),
  ];

  const sections = sectionsOf(rows, (e) => e);

  test("pins come first in the order they were made, even one that needs you", () => {
    expect(ids(sections.pinned)).toEqual(["early-pin", "late-pin"]);
  });

  test("Reviewer and walkthrough sessions leave the list, old ones by their title", () => {
    expect(ids(sections.reviews)).toEqual(["review", "old-walkthrough"]);
    expect(ids(sections.sessions)).toEqual(["needs", "plain"]);
  });

  test("a pinned review session stays in Pinned", () => {
    const pinned = entry("pinned-review", {
      origin: "walkthrough",
      pinnedAt: "2026-10-12T00:00:00.000Z",
    });

    expect(ids(sectionsOf([pinned], (e) => e).pinned)).toEqual(["pinned-review"]);
  });
});

describe("isReviewSession", () => {
  test("by origin, by a Review Checkout's directory, or by the legacy title", () => {
    expect(isReviewSession({ origin: "walkthrough", cwd: "/a", title: "x" })).toBe(true);
    expect(isReviewSession({ cwd: "/a.worktrees/.review/pr-7", title: "x" })).toBe(true);
    expect(isReviewSession({ cwd: "/a", title: "Reviewer · #9" })).toBe(true);
    expect(isReviewSession({ cwd: "/a", title: "Review the parser" })).toBe(false);
  });
});

describe("reviewsOpen", () => {
  test("folded by default, open while a review needs you, else as the user left it", () => {
    expect(reviewsOpen([entry("r")], undefined)).toBe(false);
    expect(reviewsOpen([entry("r")], false)).toBe(true);
    expect(reviewsOpen([entry("r", { state: "needs-you" })], true)).toBe(true);
  });
});

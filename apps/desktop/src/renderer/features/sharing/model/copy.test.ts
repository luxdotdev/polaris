import { describe, expect, test } from "bun:test";
import type { SharedSessionView, ShareView } from "../../../../shared/sharingContract.ts";
import {
  expiresAtFor,
  initialsOf,
  ownerGroups,
  shareLine,
  shareLog,
  shareRefusal,
} from "./copy.ts";

const NOW = Date.parse("2026-11-16T15:00:00.000Z");

const DAY = 24 * 60 * 60 * 1000;

const alex = { login: "arivera", name: "Alex Rivera", avatar: null };

const share = (patch: Partial<ShareView>): ShareView => ({
  id: "sh1",
  person: alex,
  role: "commenter",
  createdAt: new Date(NOW - DAY).toISOString(),
  expiresAt: new Date(NOW + 6 * DAY).toISOString(),
  revokedAt: null,
  live: true,
  log: [],
  ...patch,
});

describe("sharing copy", () => {
  test("a login not on the Account Server is named, with the server", () => {
    expect(shareRefusal({ code: "PersonNotFound", message: "" }, "@arikow", "Polaris Cloud")).toBe(
      "@arikow hasn't signed in to Polaris on Polaris Cloud, so they can't be invited from this account yet."
    );
    expect(shareRefusal({ code: "Unsupported", message: "" }, "arikow", "x")).toBe(
      "Couldn't share with @arikow."
    );
  });

  test("a Share reads as invited until accepted, then by its expiry, then how it ended", () => {
    expect(shareLine(share({}), NOW)).toStartWith("Invited as Commenter · not accepted yet");

    const accepted = share({ log: [{ kind: "accepted", at: "", actor: null, detail: null }] });

    expect(shareLine(accepted, NOW)).toBe("Commenter · expires in 6 days");
    expect(shareLine({ ...accepted, revokedAt: new Date(NOW).toISOString() }, NOW)).toStartWith(
      "Commenter · revoked"
    );
  });

  test("the default expiry sends null, so the Host's default applies", () => {
    expect(expiresAtFor(7, NOW)).toBeNull();
    expect(expiresAtFor(30, NOW)).toBe(new Date(NOW + 30 * DAY).toISOString());
  });

  test("the share log merges every Share's entries, newest first", () => {
    const rows = shareLog([
      share({
        log: [
          { kind: "invited", at: "2026-11-16T14:20:00.000Z", actor: "You", detail: "commenter" },
          { kind: "accepted", at: "2026-11-16T14:22:00.000Z", actor: null, detail: null },
        ],
      }),
      share({
        id: "sh2",
        person: { login: "jlee", name: "Jordan Lee", avatar: null },
        log: [{ kind: "revoked", at: "2026-11-10T09:00:00.000Z", actor: "You", detail: null }],
      }),
    ]);

    expect(rows.map((r) => r.line)).toEqual([
      "Alex Rivera joined",
      "You invited Alex Rivera as Commenter",
      "You revoked Jordan Lee",
    ]);
  });

  test("initials come from the name, else the login", () => {
    expect(initialsOf(alex)).toBe("AR");
    expect(initialsOf({ login: "octo-cat", name: null, avatar: null })).toBe("OC");
  });

  test("shared sessions group by owner; the Account shows only with more than one", () => {
    const session = (sessionId: string, owner: string, accountId = "a1"): SharedSessionView => ({
      accountId,
      hostKey: `shared:${owner}`,
      sessionId,
      title: sessionId,
      owner: { login: owner, name: null, avatar: null },
      hostName: "Mac Studio",
      role: "commenter",
      hostOffline: false,
      ended: false,
    });

    const sessions = [session("s1", "lucas"), session("s2", "priya"), session("s3", "lucas")];
    const one = ownerGroups(sessions, [{ id: "a1", login: "maya" }]);

    expect(one.map((g) => [g.owner.login, g.sessions.length, g.via])).toEqual([
      ["lucas", 2, null],
      ["priya", 1, null],
    ]);

    const two = ownerGroups(sessions, [
      { id: "a1", login: "maya" },
      { id: "a2", login: "maya-work" },
    ]);

    expect(two[0]?.via).toBe("@maya");
  });
});

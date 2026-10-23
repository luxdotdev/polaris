import { expect, test } from "bun:test";
import { type Pairing, PairingId } from "@polaris/protocol";
import type { Plain } from "../../../shared/api.ts";
import { grantLine, livePairings, toggleGrant, usedLine } from "./model.ts";

const pairing = (
  id: string,
  createdAt: string,
  extra: Partial<Plain<Pairing>> = {}
): Plain<Pairing> => ({
  id: PairingId.make(id),
  name: id,
  grant: [],
  createdAt,
  lastUsedAt: null,
  revokedAt: null,
  ...extra,
});

test("a Grant reads in the catalogue's order, whatever order it was picked in", () => {
  expect(grantLine(["turn", "read", "approve"])).toBe("Read · approve · send turns");
  expect(grantLine(["voice"])).toBe("Voice");
  expect(grantLine([])).toBe("Nothing");
});

test("toggling adds a Grant in the catalogue's order and removes it again", () => {
  expect(toggleGrant(["read", "voice"], "approve")).toEqual(["read", "approve", "voice"]);
  expect(toggleGrant(["read", "approve"], "read")).toEqual(["approve"]);
});

test("a row says when the Extension last connected", () => {
  const now = Date.parse("2026-10-23T18:10:00Z");

  expect(usedLine(pairing("a", "2026-10-01T00:00:00Z"), now)).toBe("not used yet");
  expect(
    usedLine(pairing("a", "2026-10-01T00:00:00Z", { lastUsedAt: "2026-10-23T18:06:00Z" }), now)
  ).toBe("used 4 minutes ago");
});

test("Settings lists live Pairings newest first and drops revoked ones", () => {
  const listed = livePairings([
    pairing("old", "2026-10-01T00:00:00Z"),
    pairing("gone", "2026-10-20T00:00:00Z", { revokedAt: "2026-10-21T00:00:00Z" }),
    pairing("new", "2026-10-22T00:00:00Z"),
  ]);

  expect(listed.map((p) => p.name)).toEqual(["new", "old"]);
});

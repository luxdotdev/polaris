import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { turnWith } from "../../../store/fixtures.testing.ts";
import { leadModel } from "../preview/sessions.ts";
import { digestFold, digestStarted, STEERED_DIGEST_OPENING, steeredDigest } from "./digest.ts";

describe("digestFold", () => {
  const { turns } = leadModel();
  const [earlier, digest] = turns;

  test("a folded digest Turn keeps its number and the Lead's reply", () => {
    if (digest === undefined) throw new Error("fixture has two Turns");
    const fold = digestFold(turns, digest);

    expect(fold.number).toBe(14);
    expect(fold.reply).toStartWith("B1's trace check fails on the handover log");
  });

  test("its number is the conversation's: the Daemon's user-Turn number", () => {
    if (earlier === undefined || digest === undefined) throw new Error("fixture has two Turns");

    const numbered = (view: typeof digest, userTurnNumber: number) => ({
      ...view,
      turn: turnWith({ id: view.turn.id, index: view.turn.index, userTurnNumber }),
    });

    const listed = [numbered(earlier, 6), numbered(digest, 7)];

    expect(digestFold(listed, listed[1] ?? digest).number).toBe(7);
  });

  test("before the Lead replies there is no reply line", () => {
    if (earlier === undefined) throw new Error("fixture has two Turns");

    expect(digestFold(turns, { ...earlier, items: [] }).reply).toBeNull();
  });
});

describe("digestStarted", () => {
  const base = { leadSessionId: "lead", revision: 1, at: "2026-10-11T12:00:00Z", items: [] };

  test("a digest Turn is Polaris's unless the digest was steered into it", () => {
    // SAFETY: plain test values; the branded ids compare as strings.
    const digests = [
      { ...base, turnId: "t-new" },
      { ...base, turnId: "t-user", steered: true },
      { ...base, turnId: "t-old", steered: false },
    ] as never;

    expect(digestStarted(digests, "t-new")).toBe(true);
    expect(digestStarted(digests, "t-old")).toBe(true);
    expect(digestStarted(digests, "t-user")).toBe(false);
    expect(digestStarted(digests, "t-other")).toBe(false);
  });
});

describe("steeredDigest", () => {
  const [view] = leadModel().turns;
  const at = (s: number) => `2026-10-11T12:00:0${s}Z`;
  const base = { leadSessionId: "lead", revision: 1, items: [] };
  const steer = (id: string, text: string) => TurnItem.cases.UserMessage.make({ id, text });

  test("digest steers pair with the Turn's steered digests in order; the user's own don't", () => {
    if (view === undefined) throw new Error("fixture has Turns");
    const turnId = view.turn.id;

    // SAFETY: plain test values; the branded ids compare as strings.
    const digests = [
      { ...base, turnId, steered: true, at: at(2) },
      { ...base, turnId, steered: true, at: at(1) },
      { ...base, turnId: "t-other", steered: true, at: at(0) },
      { ...base, turnId, at: at(3) },
    ] as never;

    const turn = {
      ...view,
      items: [
        steer("steer:a", `${STEERED_DIGEST_OPENING} Fold it in.`),
        steer("steer:u", "stop at 5"),
        steer("steer:b", `${STEERED_DIGEST_OPENING} Fold it in.`),
      ],
    };

    expect(steeredDigest(digests, turn, "steer:a")?.at).toBe(at(1));
    expect(steeredDigest(digests, turn, "steer:b")?.at).toBe(at(2));
    expect(steeredDigest(digests, turn, "steer:u")).toBeNull();
  });
});

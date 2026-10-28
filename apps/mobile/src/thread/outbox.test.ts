import { describe, expect, test } from "bun:test";
import { TurnId, TurnItem } from "@polaris/protocol";
import { at, turn } from "./daemon.testing.ts";
import type { TurnEntry } from "./fold.ts";
import { type OutgoingSteer, outgoingSteer, settleSteers } from "./outbox.ts";

const entry = (status: "working" | "completed", steers: ReadonlyArray<string>): TurnEntry => ({
  turn: turn(1, { status, endedAt: status === "working" ? null : at }),
  items: steers.map((text, n) =>
    TurnItem.cases.UserMessage.make({ id: `u-${n}`, text, startedAt: at })
  ),
  live: [],
  streaming: [],
});

const sent = (turns: ReadonlyArray<TurnEntry>, text: string): OutgoingSteer => ({
  ...outgoingSteer(turns, TurnId.make("t-1"), text),
  status: "sent",
});

describe("settling steers", () => {
  test("the same words sent twice land one each, past what the Turn already held", () => {
    const before = [entry("working", ["again"])];
    const second = sent(before, "again");
    const outbox = [sent(before, "again"), second];

    expect(settleSteers(outbox, [entry("working", ["again", "again"])])).toEqual([second]);
    expect(settleSteers(outbox, [entry("working", ["again", "again", "again"])])).toEqual([]);
  });

  test("still waiting while its Turn runs: the same outbox back", () => {
    const outbox = [sent([entry("working", [])], "lint too")];

    expect(settleSteers(outbox, [entry("working", [])])).toBe(outbox);
  });
});

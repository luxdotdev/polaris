import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { CodexSteers } from "./steers.ts";

const steer = (id: string, text: string) => TurnItem.cases.UserMessage.make({ id, text });

describe("CodexSteers", () => {
  test("the Turn's first user message is its prompt", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");
    steers.fromItem("t1", "u1", "fix it");

    expect(steers.take("t1")).toEqual([]);
    steers.fromItem("t1", "u2", "also lint");
    expect(steers.take("t1")).toEqual([steer("u2", "also lint")]);
  });

  test("a steer waits until the model reads it: the Turn's next item", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");
    steers.fromResponse("t1", "also lint");
    steers.fromItem("t1", "u2", "also lint");

    expect(steers.take("t1")).toEqual([steer("steer:t1:1", "also lint")]);
    expect(steers.take("t1")).toEqual([]);
  });

  test("a steer reported by both the response and an item is recorded once", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");
    steers.fromItem("t1", "u2", "again");
    steers.fromResponse("t1", "again");
    steers.fromResponse("t1", "again");

    expect(steers.take("t1")).toEqual([steer("u2", "again"), steer("steer:t1:2", "again")]);
  });

  test("steers still waiting when the Turn ends land with it", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");
    steers.fromItem("t1", "u3", "from the tui");

    expect(steers.end("t1")).toEqual([steer("u3", "from the tui")]);
    steers.fromItem("t1", "u4", "next turn prompt");
    expect(steers.take("t1")).toEqual([]);
  });
});

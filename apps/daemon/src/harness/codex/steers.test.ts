import { describe, expect, test } from "bun:test";
import { TurnItem } from "@polaris/protocol";
import { CodexSteers } from "./steers.ts";

const steer = (id: string, text: string) => TurnItem.cases.UserMessage.make({ id, text });

describe("CodexSteers", () => {
  test("the Turn's first user message is its prompt", () => {
    const steers = new CodexSteers();

    expect(steers.fromItem("t1", "u1", "fix it")).toBeNull();
    expect(steers.fromItem("t1", "u1", "fix it")).toBeNull();
    expect(steers.fromItem("t1", "u2", "also lint")).toEqual(steer("u2", "also lint"));
  });

  test("a steer reported by both the response and an item is recorded once", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");

    expect(steers.fromResponse("t1", "also lint")).toEqual(steer("steer:t1:1", "also lint"));
    expect(steers.fromItem("t1", "u2", "also lint")).toBeNull();
    expect(steers.fromItem("t1", "u2", "also lint")).toBeNull();
  });

  test("the item may come first; the same text steered twice shows twice", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");

    expect(steers.fromItem("t1", "u2", "again")).toEqual(steer("u2", "again"));
    expect(steers.fromResponse("t1", "again")).toBeNull();
    expect(steers.fromResponse("t1", "again")).toEqual(steer("steer:t1:2", "again"));
  });

  test("a steer typed in the TUI shows from its item alone", () => {
    const steers = new CodexSteers();
    steers.fromItem("t1", "u1", "fix it");

    expect(steers.fromItem("t1", "u3", "from the tui")).toEqual(steer("u3", "from the tui"));
    steers.end("t1");
    expect(steers.fromItem("t1", "u4", "next turn prompt")).toBeNull();
  });
});

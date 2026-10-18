import { TurnItem } from "@polaris/protocol";
import { describe, expect, test } from "bun:test";
import type { ToolKind } from "./protocol.ts";
import { toolCallItem } from "./translate.ts";

const call = (kind: ToolKind, title: string) =>
  toolCallItem(
    {
      fields: { toolCallId: "t1", kind, title, status: "completed", rawInput: { q: "x" } },
      declined: false,
    },
    "/repo"
  );

const expected = (kind: "search" | "other", title: string) =>
  TurnItem.cases.ToolCall.make({
    id: "t1",
    name: title,
    kind,
    title,
    input: { q: "x" },
    output: null,
    status: "completed",
  });

describe("toolCallItem", () => {
  test("keeps ACP's kind and title for the calls a Tool Run counts", () => {
    expect(call("search", "Find usages of foo")).toEqual(expected("search", "Find usages of foo"));
  });

  test("kinds a Tool Run doesn't count are other", () => {
    expect(call("think", "Ponder")).toEqual(expected("other", "Ponder"));
  });
});

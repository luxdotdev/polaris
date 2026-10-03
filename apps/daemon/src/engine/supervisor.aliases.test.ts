import { expect, test } from "bun:test";
import { SubagentId, TurnId, TurnItem } from "@polaris/protocol";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { HarnessTurnAliases } from "./supervisor.aliases.ts";

test("TurnEnded prunes native aliases while live children retain their recorded Turn", () => {
  const aliases = new HarnessTurnAliases<Record<string, never>>();
  const source = {};
  const native = TurnId.make("native");
  const target = TurnId.make("recorded");
  const subagentId = SubagentId.make("child");
  aliases.set(source, native, target);
  aliases.set(source, TurnId.make("another-native"), target);
  expect(
    aliases.resolve(
      source,
      HarnessEvent.SubagentStarted({
        turnId: native,
        subagentId,
        parentItemId: "call",
        title: "Check",
        agent: null,
        model: null,
      })
    )
  ).toMatchObject({ turnId: target });
  const end = HarnessEvent.TurnEnded({ turnId: target, status: "completed", error: null });
  aliases.ended(source, end);

  const item = HarnessEvent.ItemCompleted({
    turnId: native,
    subagentId,
    item: TurnItem.cases.AssistantMessage.make({ id: "report", text: "Done" }),
  });

  expect(aliases.resolve(source, item)).toMatchObject({ turnId: target });

  for (const id of [native, TurnId.make("another-native")]) {
    const root = HarnessEvent.TurnStarted({ turnId: id, prompt: "Next" });
    expect(aliases.resolve(source, root)).toBe(root);
  }

  aliases.ended(source, HarnessEvent.SubagentEnded({ subagentId, status: "completed" }));
  expect(aliases.resolve(source, item)).toBe(item);
});

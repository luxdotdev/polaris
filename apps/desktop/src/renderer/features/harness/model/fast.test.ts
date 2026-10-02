import { expect, test } from "bun:test";
import { fastToggle } from "./fast.ts";
import type { ModelChoice } from "./models.ts";

test("/fast preserves Model and effort, explicitly enables and disables priority routing", () => {
  let choice: ModelChoice = { model: null, effort: null };

  const change = (next: ModelChoice) => {
    choice = next;
  };

  fastToggle(true, undefined, choice, change)?.();
  expect(choice).toEqual({ model: null, effort: null, serviceTier: "priority" });
  fastToggle(true, undefined, choice, change)?.();
  expect(choice).toEqual({ model: null, effort: null, serviceTier: "default" });
  expect(fastToggle(false, undefined, choice, change)).toBeUndefined();
  expect(fastToggle(true, "Wait for the Turn to end", choice, change)).toBeUndefined();
});

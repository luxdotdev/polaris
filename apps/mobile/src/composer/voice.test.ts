import { expect, test } from "bun:test";
import { withHeard } from "./voice.ts";

test.each([
  ["", "", "", ""],
  ["", "fix the", "login", "fix the login"],
  ["Look at auth.ts ", "and fix", "it", "Look at auth.ts and fix it"],
  ["Look at auth.ts", "", "and", "Look at auth.ts and"],
  ["Typed only", "", "", "Typed only"],
])("typed %p then heard %p + %p reads %p", (typed, finalText, interimText, field) => {
  expect(withHeard(typed, { finalText, interimText })).toBe(field);
});

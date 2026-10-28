import { expect, test } from "bun:test";
import { dictate, dictateFrom, withHeard } from "./voice.ts";

test.each([
  ["", "", "", ""],
  ["", "fix the", "login", "fix the login"],
  ["Look at auth.ts ", "and fix", "it", "Look at auth.ts and fix it"],
  ["Look at auth.ts", "", "and", "Look at auth.ts and"],
  ["Typed only", "", "", "Typed only"],
])("typed %p then heard %p + %p reads %p", (typed, finalText, interimText, field) => {
  expect(withHeard(typed, { finalText, interimText })).toBe(field);
});

test("an edit since the last write is the new start, and words already written stay out", () => {
  const first = dictate(dictateFrom("typed"), "typed", { finalText: "a b", interimText: "" });
  expect(first.written).toBe("typed a b");

  const edited = dictate(first, "rewritten", { finalText: "a b c", interimText: "" });
  expect(edited.written).toBe("rewritten c");
  expect(dictate(edited, edited.written, { finalText: "a b c d", interimText: "" }).written).toBe(
    "rewritten c d"
  );
});

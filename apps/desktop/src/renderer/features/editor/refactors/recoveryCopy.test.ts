import { expect, test } from "bun:test";
import { failureCopy, filesIn, recoveryCopy } from "./recoveryCopy.ts";
import { proposal } from "./testing.ts";

test("names the files, briefly", () => {
  expect(filesIn(["/r/a.ts"])).toBe("a.ts");
  expect(filesIn(["/r/a.ts", "/r/b.ts"])).toBe("a.ts and b.ts");
  expect(filesIn(["/r/a.ts", "/r/b.ts", "/r/c.ts", "/r/d.ts"])).toBe("a.ts, b.ts and 2 more");
});

test("one sentence naming what happened and to which files, with plain verbs", () => {
  const touched = ["/checkout/a.ts", "/checkout/b.ts", "/checkout/c.ts"];

  expect(recoveryCopy({ state: "partial", touched, proposal: proposal(), outcome: null })).toEqual({
    text: "Rename symbol stopped partway through a.ts, b.ts and 1 more.",
    actions: [
      { action: "check", label: "Check again" },
      { action: "undo", label: "Undo" },
    ],
  });
  expect(recoveryCopy({ state: "unknown", touched, proposal: proposal(), outcome: null })).toEqual({
    text: "Rename symbol: couldn't confirm it finished in a.ts, b.ts and 1 more.",
    actions: [{ action: "check", label: "Check again" }],
  });
});

test("a failure outside the preview is one line with Dismiss", () => {
  expect(failureCopy("Error: The file isn't open.")).toEqual({
    text: "Couldn't finish the refactor. The file isn't open.",
    actions: [{ action: "dismiss", label: "Dismiss" }],
  });
});

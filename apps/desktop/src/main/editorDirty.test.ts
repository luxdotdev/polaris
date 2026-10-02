import { describe, expect, test } from "bun:test";
import { quitMessage } from "./editorDirty.ts";

describe("the quit prompt", () => {
  test("names the files, and says unsaved edits come back", () => {
    const { message, detail } = quitMessage([{ hostKey: "h", path: "/r/a.ts", unkept: false }]);

    expect(message).toBe("Save changes to a.ts before quitting?");
    expect(detail).toContain("brings them back next time");
  });

  test("says which edits are too large to keep (QCHECK B1)", () => {
    const { message, detail } = quitMessage([
      { hostKey: "h", path: "/r/a.ts", unkept: false },
      { hostKey: "h", path: "/r/huge.json", unkept: true },
    ]);

    expect(message).toBe("Save changes to 2 files before quitting?");
    expect(detail).toContain("huge.json is too large to keep after quitting");
  });
});

import { expect, test } from "bun:test";
import { modeLabel, modeTone } from "./vim.ts";

test("Every visual mode shares VISUAL's badge, and replace types like insert", () => {
  expect(modeTone(modeLabel("visual", "linewise"))).toBe("visual");
  expect(modeTone(modeLabel("visual", "blockwise"))).toBe("visual");
  expect(modeTone(modeLabel("visual"))).toBe("visual");
  expect(modeTone(modeLabel("replace"))).toBe("insert");
  expect(modeTone(modeLabel("insert"))).toBe("insert");
  expect(modeTone(modeLabel("something-new"))).toBe("normal");
});

import { expect, test } from "bun:test";
import { unlinkNote } from "./model.ts";

test("Unlink names the hosts that still trust this iPhone, and says nothing when none do", () => {
  expect(unlinkNote([])).toBeNull();
  expect(unlinkNote(["Pi 4"])).toBe(
    "Still linked to Pi 4: it didn't answer. Unlink again when it's online, or unlink this iPhone on your Mac in Settings → Devices."
  );
});

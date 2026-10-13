import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings } from "../settings.ts";

test("the SSH binary override survives settings persistence", () => {
  const root = mkdtempSync(join(tmpdir(), "polaris-ssh-settings-"));
  const path = join(root, "settings.json");

  try {
    const settings = { sshBinary: "C:\\Program Files\\Git\\usr\\bin\\ssh.exe" };

    writeSettings({ path, settings });
    expect(readSettings(path)).toEqual(settings);
    expect(() => writeSettings({ path, settings: { sshBinary: "" } })).toThrow();
    writeSettings({ path, settings: {} });
    expect(readSettings(path)).toEqual({});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

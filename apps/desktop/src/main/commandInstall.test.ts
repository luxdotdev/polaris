import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandInstaller } from "./commandInstall.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "desktop-command-"));
  const target = join(home, ".polaris/bin/current/polaris");
  mkdirSync(join(home, ".polaris/bin/current"), { recursive: true });
  writeFileSync(target, "#!/bin/sh\n");
  chmodSync(target, 0o755);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const manager = () => {
  let dismissed = false;

  return createCommandInstaller({
    userHome: home,
    platform: "darwin",
    path: () => "/usr/bin:/bin",
    dismissed: () => dismissed,
    dismiss: () => {
      dismissed = true;
    },
  });
};

test("Desktop installs and uninstalls the stable local command, reports PATH and remembers dismissal", async () => {
  const command = manager();
  const installed = await command.change("install", "user");
  expect(installed.links[0]).toMatchObject({ state: "installed", onPath: false });
  expect(readlinkSync(join(home, ".local/bin/polaris"))).toBe(
    join(home, ".polaris/bin/current/polaris")
  );
  expect(command.dismiss().dismissed).toBe(true);
  expect((await command.change("uninstall", "user")).links[0]?.state).toBe("absent");
});

test("missing Daemon and an existing command produce actionable failures", async () => {
  const command = manager();
  rmSync(join(home, ".polaris"), { recursive: true });
  expect(await command.change("install", "user").catch((error: Error) => error.message)).toContain(
    "local daemon"
  );
  mkdirSync(join(home, ".local/bin"), { recursive: true });
  writeFileSync(join(home, ".local/bin/polaris"), "another command");
  expect(
    await command.change("uninstall", "user").catch((error: Error) => error.message)
  ).toContain("another command");
});

test("a canceled administrator prompt reports the failure and releases the installation lock", async () => {
  const command = createCommandInstaller({
    userHome: home,
    systemBin: join(home, "system-bin"),
    platform: "darwin",
    path: () => "",
    dismissed: () => false,
    dismiss: () => {},
    authorize: () => Promise.reject(new Error("User canceled")),
  });

  expect(
    await command.change("install", "system").catch((error: Error) => error.message)
  ).toContain("User canceled");
  expect((await command.change("install", "user")).links[0]?.state).toBe("installed");
});

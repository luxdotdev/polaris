import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { systemCommandScript } from "./commandInstall.ts";

const homes: Array<string> = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("the administrator script quotes paths, is idempotent, and removes only its own link", () => {
  const home = mkdtempSync(join(tmpdir(), "command-admin-"));
  homes.push(home);
  const path = join(home, "system bin/polaris");
  const target = join(home, "Ada's $HOME; .polaris/bin/current/polaris");

  const run = (action: "install" | "uninstall") =>
    spawnSync("/bin/sh", ["-c", systemCommandScript(action, path, target)], { encoding: "utf8" });

  expect(run("install").status).toBe(0);
  expect(run("install").status).toBe(0);
  expect(readlinkSync(path)).toBe(target);
  expect(run("uninstall").status).toBe(0);
  expect(run("uninstall").status).toBe(0);
  writeFileSync(path, "user-owned");
  expect(run("install").status).toBe(1);
  expect(run("uninstall").status).toBe(0);
  expect(readFileSync(path, "utf8")).toBe("user-owned");
});

test("the administrator script preserves another install's dangling link", () => {
  const home = mkdtempSync(join(tmpdir(), "command-admin-other-"));
  homes.push(home);
  const path = join(home, "polaris");
  mkdirSync(join(home, "unused"));
  symlinkSync("another-home", path);

  const result = spawnSync("/bin/sh", [
    "-c",
    systemCommandScript("uninstall", path, join(home, ".polaris/bin/current/polaris")),
  ]);

  expect(result.status).toBe(0);
  expect(readlinkSync(path)).toBe("another-home");
});

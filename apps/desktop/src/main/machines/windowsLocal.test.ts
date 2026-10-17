/**
 * This PC's Daemon on a Windows Client: the plan from what is installed and bundled, and the
 * `polaris.exe` commands it runs, with no shell. Spawns are scripted, so this runs on any OS.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installedPaths } from "@polaris/client";
import type { DaemonBuild } from "@polaris/client/install";
import { type SpawnRequest, scriptedChildProcess } from "@polaris/client/process";
import { Effect, Predicate } from "effect";
import {
  applyWindowsLocal,
  installedVersion,
  planWindowsLocal,
  startWindowsLocal,
} from "./windowsLocal.ts";

const build = (version: string, bundled = true): DaemonBuild => ({
  platform: "windows-x64",
  version,
  sha256: "ab".repeat(32),
  bundled,
  archive: null,
  files: [
    {
      name: "polaris.exe",
      path: "C:\\Polaris\\resources\\daemon\\windows-x64\\polaris.exe",
      sha256: "ab".repeat(32),
      size: 10,
      executable: true,
    },
  ],
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polaris-this-pc-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const installVersion = () => {
  const binary = installedPaths(home, "win32").binary;

  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, "");
};

/** Every spawn recorded and answered with `stdout`. */
const recording = (stdout: string, code = 0) => {
  const spawned: Array<SpawnRequest> = [];

  const processes = scriptedChildProcess((request) => {
    spawned.push(request);

    return { exit: { code, stdout } };
  });

  return { spawned, processes };
};

describe("planWindowsLocal", () => {
  test("installs the bundled build when nothing is, with no approval, even in the background", () => {
    for (const trigger of ["user", "background"] as const)
      expect(planWindowsLocal(null, [build("1.2.0")], trigger)._tag).toBe("Install");
  });

  test("upgrades an older Daemon, and leaves a newer or the same one", () => {
    const upgrade = planWindowsLocal("1.1.0", [build("1.2.0")], "background");

    expect(upgrade._tag).toBe("Upgrade");
    expect(upgrade).toMatchObject({ from: "1.1.0" });
    expect(planWindowsLocal("1.3.0", [build("1.2.0")], "user")._tag).toBe("InstalledNewer");
    expect(planWindowsLocal("1.2.0", [build("1.2.0")], "user")._tag).toBe("UpToDate");
  });

  test("a package without the Windows build in it has nothing to install", () => {
    expect(planWindowsLocal(null, [], "user")._tag).toBe("MissingBuild");
    expect(planWindowsLocal(null, [build("1.2.0", false)], "user")._tag).toBe("MissingBuild");
  });
});

describe("this PC's polaris.exe", () => {
  test("the installed version is what `polaris.exe version` says; none when absent", async () => {
    const absent = recording("");
    expect(await Effect.runPromise(installedVersion(home, absent.processes))).toBeNull();
    expect(absent.spawned).toEqual([]);

    installVersion();
    const present = recording("polaris 1.1.0 windows-x64\r\n");
    expect(await Effect.runPromise(installedVersion(home, present.processes))).toBe("1.1.0");
    expect(present.spawned[0]).toMatchObject({
      file: installedPaths(home, "win32").binary,
      args: ["version"],
    });
  });

  test("a first install runs the bundled binary's install, for this home", async () => {
    const t = recording('{"ok":true,"action":"install","notes":[]}');
    const plan = planWindowsLocal(null, [build("1.2.0")], "user");

    if (!Predicate.isTagged(plan, "Install")) throw new Error(plan._tag);
    const outcome = await Effect.runPromise(applyWindowsLocal(home, plan, t.processes));

    expect(outcome).toMatchObject({ kind: "installed", version: "1.2.0" });
    expect(t.spawned[0]).toMatchObject({
      file: build("1.2.0").files[0]!.path,
      args: ["install", "--json", "--sha256", "ab".repeat(32)],
    });
    expect(t.spawned[0]?.env?.POLARIS_HOME).toBe(join(home, ".polaris"));
  });

  test("an upgrade hands the bundled binary to the installed one's upgrade", async () => {
    const t = recording('{"ok":true,"action":"restarted"}');
    const plan = planWindowsLocal("1.1.0", [build("1.2.0")], "user");

    if (!Predicate.isTagged(plan, "Upgrade")) throw new Error(plan._tag);
    const outcome = await Effect.runPromise(applyWindowsLocal(home, plan, t.processes));

    expect(outcome).toMatchObject({ kind: "upgraded", version: "1.2.0", from: "1.1.0" });
    expect(t.spawned[0]?.file).toBe(installedPaths(home, "win32").binary);
    expect(t.spawned[0]?.args.slice(0, 2)).toEqual(["upgrade", build("1.2.0").files[0]!.path]);
  });

  test("a failed command fails with the message its JSON gave", async () => {
    const t = recording('{"ok":false,"message":"did not start: sign in to Windows"}', 1);
    const error = await Effect.runPromise(Effect.flip(startWindowsLocal(home, t.processes)));

    expect(error).toMatchObject({ step: "start", message: "did not start: sign in to Windows" });
  });
});

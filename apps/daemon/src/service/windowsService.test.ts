import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { CommandRunner } from "./CommandRunner.ts";
import { TaskConflictError } from "./errors.ts";
import {
  activateWindowsTask,
  planWindowsTask,
  removeWindowsTask,
  type WindowsTaskFacts,
} from "./windowsService.ts";
import { taskWorkingDirectory, taskXml, taskXmlBytes } from "./windowsTask.ts";

const facts = (overrides: Partial<WindowsTaskFacts>): WindowsTaskFacts => ({
  registered: true,
  changed: { binary: false, serviceFile: false },
  running: { pid: 42, version: "0.2.0" },
  version: "0.2.0",
  ...overrides,
});

describe("planWindowsTask", () => {
  test("a second install of what already runs touches nothing", () => {
    expect(planWindowsTask(facts({}))).toEqual({ register: false, stop: null, start: false });
  });

  test("a new binary stops the running Daemon as an upgrade, then starts the task", () => {
    expect(
      planWindowsTask(facts({ changed: { binary: true, serviceFile: false }, version: "0.2.1" }))
    ).toEqual({ register: false, stop: "upgrade", start: true });
  });

  test("a Daemon of another version is replaced even when the files were already in place", () => {
    expect(planWindowsTask(facts({ version: "0.2.1" }))).toMatchObject({ stop: "upgrade" });
  });

  test("a changed task definition re-registers and restarts, since the running loop is the old one", () => {
    expect(planWindowsTask(facts({ changed: { binary: false, serviceFile: true } }))).toEqual({
      register: true,
      stop: "restart",
      start: true,
    });
  });

  test("a task removed by hand is registered again", () => {
    expect(planWindowsTask(facts({ registered: false, running: null }))).toEqual({
      register: true,
      stop: null,
      start: true,
    });
  });

  test("with no Daemon answering, the task is started without stopping anything", () => {
    expect(planWindowsTask(facts({ running: null }))).toEqual({
      register: false,
      stop: null,
      start: true,
    });
  });
});

/** A Polaris home with `bin\current\polaris.exe`, as an install leaves it. */
const installedHome = () => {
  const home = mkdtempSync(join(tmpdir(), "polaris-installed-"));
  mkdirSync(join(home, "bin", "current"), { recursive: true });
  writeFileSync(join(home, "bin", "current", "polaris.exe"), "");

  return home;
};

/** `schtasks` with one task registered, which runs `home`; records every call. */
const schtasksWith = (home: string) => {
  const calls: Array<string> = [];
  const xml = taskXml({ userSid: "S-1-5-21-1", polarisHome: home, systemRoot: "C:\\Windows" });

  const layer = Layer.succeed(
    CommandRunner,
    CommandRunner.of({
      run: (argv) =>
        Effect.sync(() => {
          calls.push(argv.join(" "));

          return { code: 0, stdout: argv[1] === "/Query" ? xml : "", stderr: "" };
        }),
    })
  );

  return { calls, layer };
};

describe("activateWindowsTask", () => {
  test("a task that runs another installed home is left alone, and the error says whose it is", async () => {
    const real = installedHome();
    const { calls, layer } = schtasksWith(real);

    const target = {
      task: "dev.lux.polaris.lucas",
      home: join(tmpdir(), "redirected", ".polaris"),
      definition: "polaris-task.xml",
    };

    try {
      const error = await Effect.runPromise(
        activateWindowsTask(target, { binary: true, serviceFile: true }, "0.2.0", false).pipe(
          Effect.flip,
          Effect.provide(layer)
        )
      );

      expect(error).toBeInstanceOf(TaskConflictError);
      expect(error.message).toContain(`runs the Polaris home ${real}`);
      expect(error.message).toContain("--replace-task");
      expect(calls.filter((call) => / \/(Create|Run|Delete) /.test(call))).toEqual([]);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });
});

const windows = process.platform === "win32";

const PROFILE_PROBE = `
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { realProfileDirectory } from "./windowsProfile.ts";
import { windowsTaskName } from "./windowsTask.ts";
const profile = realProfileDirectory();
const name = windowsTaskName(userInfo().username, join(homedir(), ".polaris"), profile);
console.log(JSON.stringify({ profile, home: homedir(), name }));
`;

// A real task stands in for the real install's: a redirected home must neither replace nor delete it.
describe.skipIf(!windows)("a redirected home and the real install's task (Windows only)", () => {
  test("the profile from the token ignores a redirected USERPROFILE, so the name gets a hash", () => {
    const fake = mkdtempSync(join(tmpdir(), "polaris-fake-profile-"));
    const probe = join(import.meta.dir, `.profile-probe-${process.pid}.ts`);
    writeFileSync(probe, PROFILE_PROBE);

    try {
      const ran = Bun.spawnSync([process.execPath, probe], {
        env: { ...process.env, USERPROFILE: fake, HOME: fake },
      });

      // SAFETY: the probe prints exactly this object as one JSON line.
      const seen = JSON.parse(ran.stdout.toString()) as {
        profile: string | null;
        home: string;
        name: string;
      };

      expect(seen.home).toBe(fake);
      expect(seen.profile?.toLowerCase()).not.toBe(fake.toLowerCase());
      expect(seen.name).toMatch(/\.[0-9a-f]{8}$/);
    } finally {
      rmSync(probe, { force: true });
      rmSync(fake, { recursive: true, force: true });
    }
  });

  test("install refuses the task and uninstall keeps it; both leave it running the real home", async () => {
    const real = installedHome();
    const redirected = mkdtempSync(join(tmpdir(), "polaris-redirected-"));
    const name = `dev.lux.polaris.eng322-test-${process.pid}`;
    const { currentUserSid } = await import("../transport/windowsPipe/win32.ts");

    const definition = (home: string) => {
      const file = join(home, "polaris-task.xml");
      const systemRoot = process.env.SystemRoot ?? "C:\\Windows";
      writeFileSync(
        file,
        taskXmlBytes(taskXml({ userSid: currentUserSid(), polarisHome: home, systemRoot }))
      );

      return file;
    };

    const runsHome = () =>
      taskWorkingDirectory(
        Bun.spawnSync(["schtasks", "/Query", "/TN", name, "/XML"]).stdout.toString()
      );

    const run = <A, E>(effect: Effect.Effect<A, E, CommandRunner>) =>
      Effect.runPromise(effect.pipe(Effect.provide(CommandRunner.layer)));

    try {
      const created = Bun.spawnSync([
        "schtasks",
        "/Create",
        "/F",
        "/TN",
        name,
        "/XML",
        definition(real),
      ]);

      expect(created.exitCode).toBe(0);
      const target = { task: name, home: redirected, definition: definition(redirected) };

      const refused = await run(
        activateWindowsTask(target, { binary: true, serviceFile: true }, "0.2.0", false).pipe(
          Effect.flip
        )
      );

      expect(refused).toBeInstanceOf(TaskConflictError);
      expect(runsHome()).toBe(real);
      const removed = await run(removeWindowsTask(target));
      expect(removed.keptTask).toBe(name);
      expect(runsHome()).toBe(real);
    } finally {
      Bun.spawnSync(["schtasks", "/Delete", "/F", "/TN", name]);
      rmSync(real, { recursive: true, force: true });
      rmSync(redirected, { recursive: true, force: true });
    }
  });
});

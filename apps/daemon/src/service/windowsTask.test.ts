import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claimTask,
  stopsOtherHome,
  supervisorLoop,
  taskWorkingDirectory,
  taskXml,
  taskXmlBytes,
  windowsTaskName,
} from "./windowsTask.ts";

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const element = (xml: string, name: string) => {
  const found = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);

  return found === null ? null : unescapeXml(found[1]!);
};

const spec = (polarisHome: string) => ({
  userSid: "S-1-5-21-1-2-3-1001",
  polarisHome,
  systemRoot: "C:\\WINDOWS",
});

describe("windowsTaskName", () => {
  const profile = "C:\\Users\\lucas";

  test("the real profile's home gets the plain name, however its path is spelled", () => {
    expect(windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", profile)).toBe(
      windowsTaskName("lucas", "c:\\users\\LUCAS\\.polaris\\", profile)
    );
    expect(windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", profile)).toBe(
      "dev.lux.polaris.lucas"
    );
  });

  test.each([
    ["another POLARIS_HOME", "C:\\Users\\lucas\\polaris-s3\\home", profile],
    // USERPROFILE redirected to a dev home: its default .polaris is still not the real profile's.
    ["a redirected home's .polaris", "C:\\Users\\lucas\\dev\\.polaris", profile],
    ["any home when the real profile is unknown", "C:\\Users\\lucas\\.polaris", null],
  ])("%s gets its own hashed task, leaving the real one alone", (_, home, realProfile) => {
    const real = windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", profile);
    const other = windowsTaskName("lucas", home, realProfile);

    expect(other).toMatch(/^dev\.lux\.polaris\.lucas\.[0-9a-f]{8}$/);
    expect(other).not.toBe(real);
  });

  test("two homes get two names, one home one name whatever the profile", () => {
    const a = windowsTaskName("lucas", "C:\\work\\a", profile);

    expect(windowsTaskName("lucas", "C:\\work\\b", profile)).not.toBe(a);
    expect(windowsTaskName("lucas", "c:\\WORK\\a\\", null)).toBe(a);
  });

  test("characters a task name can't hold are replaced", () => {
    expect(windowsTaskName("dom\\ann:x", "C:\\h\\.polaris", "C:\\h")).toBe(
      "dev.lux.polaris.dom_ann_x"
    );
  });
});

describe("taskWorkingDirectory", () => {
  test("reads the home back from a registered definition, XML escapes undone", () => {
    const home = 'C:\\Users\\R&D <x> "q"\\.polaris';

    expect(taskWorkingDirectory(taskXml(spec(home)))).toBe(home);
  });

  test("a task with no working directory isn't Polaris'", () => {
    expect(
      taskWorkingDirectory("<Task><Actions><Exec><Command>x</Command></Exec></Actions></Task>")
    ).toBeNull();
  });
});

describe("claimTask", () => {
  const home = "C:\\Users\\lucas\\.polaris";
  const dev = "C:\\Users\\lucas\\dev\\.polaris";

  test("a task that runs this home is ours, also as a 0.2.0-dev install spelled it", () => {
    expect(
      claimTask({ home: "c:\\users\\Lucas\\.polaris\\", homeInstalled: true }, home, false)
    ).toBe("ours");
  });

  test("a task that runs another installed home is refused unless --replace-task", () => {
    const existing = { home: dev, homeInstalled: true };

    expect(claimTask(existing, home, false)).toBe("conflict");
    expect(claimTask(existing, home, true)).toBe("taken-over");
  });

  test("a task left by a home with nothing installed may be replaced", () => {
    expect(claimTask({ home: dev, homeInstalled: false }, home, false)).toBe("abandoned");
  });

  test("a task under the name that isn't Polaris' is refused unless --replace-task", () => {
    expect(claimTask({ home: null, homeInstalled: false }, home, false)).toBe("conflict");
  });
});

describe("stopsOtherHome", () => {
  const dev = "C:\\Users\\lucas\\dev\\.polaris";

  test("a take-over stops the other home's Daemon only while the task runs it", () => {
    expect(stopsOtherHome("taken-over", dev, true)).toBe(true);
    expect(stopsOtherHome("taken-over", dev, false)).toBe(false);
  });

  test("when Task Scheduler can't say, it stops it, as before ENG-325", () => {
    expect(stopsOtherHome("taken-over", dev, null)).toBe(true);
  });

  test("nothing else stops another home's Daemon", () => {
    for (const claim of ["absent", "ours", "abandoned", "conflict"] as const)
      expect(stopsOtherHome(claim, dev, true)).toBe(false);
    expect(stopsOtherHome("taken-over", null, true)).toBe(false);
  });
});

describe("taskXml", () => {
  test("a home with XML and cmd metacharacters stays out of the loop's command line", () => {
    const home = "C:\\Users\\R&D %USERNAME% <x>\\.polaris";
    const xml = taskXml(spec(home));

    expect(element(xml, "WorkingDirectory")).toBe(home);
    const args = element(xml, "Arguments")!;

    expect(args).toBe(`--headless C:\\WINDOWS\\System32\\cmd.exe ${supervisorLoop()}`);
    expect(args).not.toContain("R&D");
  });

  test("Task Scheduler expands %NAME% pairs in arguments, so the loop has only cmd's %i", () => {
    expect(supervisorLoop().match(/%/g)).toHaveLength(1);
  });

  test("the file starts with the UTF-16 LE byte-order mark its declaration promises", () => {
    const bytes = taskXmlBytes(taskXml(spec("C:\\h\\.polaris")));

    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(Buffer.from(bytes.subarray(2)).toString("utf16le")).toStartWith(
      '<?xml version="1.0" encoding="UTF-16"?>'
    );
  });
});

const windows = process.platform === "win32";

// Registers a real per-user task (no administrator), reads it back, and deletes it.
describe.skipIf(!windows)("schtasks accepts the definition (Windows only)", () => {
  test("registered from the file, the task runs unelevated at the user's logon with no time limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-task-"));
    const name = `dev.lux.polaris.test-${process.pid}`;
    const { currentUserSid } = await import("../transport/windowsPipe/win32.ts");
    const file = join(dir, "task.xml");
    writeFileSync(
      file,
      taskXmlBytes(
        taskXml({
          userSid: currentUserSid(),
          polarisHome: dir,
          systemRoot: process.env.SystemRoot ?? "C:\\Windows",
        })
      )
    );

    try {
      const created = Bun.spawnSync(["schtasks", "/Create", "/F", "/TN", name, "/XML", file]);
      expect(created.exitCode).toBe(0);
      const queried = Bun.spawnSync(["schtasks", "/Query", "/TN", name, "/XML"]);
      const xml = queried.stdout.toString();

      // Task Scheduler leaves out a RunLevel that is the default, LeastPrivilege.
      expect(element(xml, "RunLevel") ?? "LeastPrivilege").toBe("LeastPrivilege");
      expect(element(xml, "LogonType")).toBe("InteractiveToken");
      expect(element(xml, "ExecutionTimeLimit")).toBe("PT0S");
      expect(element(xml, "DisallowStartIfOnBatteries")).toBe("false");
      expect(element(xml, "WorkingDirectory")).toBe(dir);
    } finally {
      Bun.spawnSync(["schtasks", "/Delete", "/F", "/TN", name]);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

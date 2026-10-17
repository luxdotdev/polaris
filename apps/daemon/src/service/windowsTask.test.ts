import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supervisorLoop, taskXml, taskXmlBytes, windowsTaskName } from "./windowsTask.ts";

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
  const userHome = "C:\\Users\\lucas";

  test("the default home gets the plain name, however its path is spelled", () => {
    expect(windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", userHome)).toBe(
      windowsTaskName("lucas", "c:\\users\\LUCAS\\.polaris\\", userHome)
    );
    expect(windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", userHome)).toBe(
      "dev.lux.polaris.lucas"
    );
  });

  test("another POLARIS_HOME gets its own task, so a test install leaves the real one alone", () => {
    const real = windowsTaskName("lucas", "C:\\Users\\lucas\\.polaris", userHome);
    const other = windowsTaskName("lucas", "C:\\Users\\lucas\\polaris-s3\\home", userHome);

    expect(other).not.toBe(real);
    expect(other.startsWith(`${real}.`)).toBe(true);
  });

  test("characters a task name can't hold are replaced", () => {
    expect(windowsTaskName("dom\\ann:x", "C:\\h\\.polaris", "C:\\h")).toBe(
      "dev.lux.polaris.dom_ann_x"
    );
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

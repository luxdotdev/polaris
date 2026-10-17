import { describe, expect, test } from "bun:test";
import {
  envValue,
  killTree,
  normalizeWindowsEnv,
  ownProcessGroup,
  shellCommand,
  taskkillArgv,
} from "./processes.ts";

const isRunning = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const waitUntil = async (done: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;

  while (!done() && Date.now() < deadline) await Bun.sleep(20);

  return done();
};

describe("the Windows environment", () => {
  test("Path becomes PATH, so a copy of the environment still has it", () => {
    const env = { Path: "C:\\bin;D:\\tools", ComSpec: "x" };
    normalizeWindowsEnv("win32", env);
    expect(Object.entries({ ...env })).toEqual([
      ["ComSpec", "x"],
      ["PATH", "C:\\bin;D:\\tools"],
    ]);
  });

  test("elsewhere a variable named Path is someone's own and stays", () => {
    const env = { Path: "/x", PATH: "/usr/bin" };
    normalizeWindowsEnv("darwin", env);
    expect(env).toEqual({ Path: "/x", PATH: "/usr/bin" });
  });

  test("a variable is found whatever case Windows kept it in", () => {
    expect(envValue({ SystemRoot: "D:\\Win" }, "SYSTEMROOT")).toBe("D:\\Win");
    expect(taskkillArgv(42, { SystemRoot: "D:\\Win" })[0]).toMatch(
      /^D:\\Win[\\/]System32[\\/]taskkill\.exe$/
    );
  });
});

describe("shellCommand", () => {
  test("POSIX runs the line with /bin/sh -c", () => {
    expect(shellCommand("bun install && echo ok", "linux")).toEqual({
      argv: ["/bin/sh", "-c", "bun install && echo ok"],
      windowsVerbatimArguments: false,
    });
  });

  test("Windows runs it under ComSpec without AutoRun, quoted for /s", () => {
    expect(shellCommand('npm ci && echo "done"', "win32", { ComSpec: "C:\\W\\cmd.exe" })).toEqual({
      argv: ["C:\\W\\cmd.exe", "/d", "/s", "/c", '"npm ci && echo "done""'],
      windowsVerbatimArguments: true,
    });
  });

  test("the line's own operators and quotes reach the shell intact", async () => {
    const line =
      process.platform === "win32"
        ? 'echo one "two three" & echo four && exit /b 3'
        : "echo one '\"two three\"'; echo four && exit 3";

    const shell = shellCommand(line);

    const proc = Bun.spawn(shell.argv, {
      stdout: "pipe",
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    });

    const out = (await proc.stdout.text()).replaceAll("\r", "").replaceAll(/ +\n/g, "\n");
    expect({ out, code: await proc.exited }).toEqual({
      out: 'one "two three"\nfour\n',
      code: 3,
    });
  });
});

describe("killTree", () => {
  test("ends the process and what it started", async () => {
    const line =
      process.platform === "win32" ? "ping -n 600 127.0.0.1 >NUL" : "sleep 600 & echo $!; wait";

    const shell = shellCommand(line);

    const proc = Bun.spawn(shell.argv, {
      stdout: "pipe",
      detached: ownProcessGroup(),
      windowsVerbatimArguments: shell.windowsVerbatimArguments,
    });

    const grandchild =
      process.platform === "win32" ? await windowsChild(proc.pid) : await firstLinePid(proc.stdout);

    expect([isRunning(proc.pid), isRunning(grandchild)]).toEqual([true, true]);
    await killTree(proc.pid, "SIGKILL");
    await proc.exited;
    expect(await waitUntil(() => !isRunning(grandchild))).toBe(true);
  });
});

const firstLinePid = async (stdout: ReadableStream<Uint8Array>) => {
  const reader = stdout.getReader();
  let text = "";

  while (!text.includes("\n")) {
    const next = await reader.read();

    if (next.done) break;
    text += new TextDecoder().decode(next.value);
  }

  reader.releaseLock();

  return Number(text.trim());
};

/** The pid of `parent`'s child, from Windows' process table. */
const windowsChild = async (parent: number): Promise<number> => {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const query = Bun.spawnSync([
      "powershell.exe",
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${parent}' | Where-Object Name -eq 'PING.EXE').ProcessId`,
    ]);

    const pid = Number(query.stdout.toString().trim());

    if (pid > 0) return pid;
    await Bun.sleep(100);
  }

  throw new Error(`no child of ${parent} appeared`);
};

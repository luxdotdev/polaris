import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  linuxTerminalCommands,
  openClientTerminal,
  openLinuxTerminal,
  openWindowsTerminal,
  sshArgv,
  terminalScript,
  type TerminalCommand,
  windowsTerminalCommands,
} from "./terminal.ts";

test("Windows Terminal receives the selected SSH binary and literal alias", async () => {
  const calls: Array<TerminalCommand> = [];
  await openWindowsTerminal(
    ["C:\\Windows\\System32\\OpenSSH\\ssh.exe", "--", "studio"],
    (command) => {
      calls.push(command);

      return Promise.resolve(true);
    }
  );
  expect(calls).toEqual([
    {
      file: "wt.exe",
      args: ["new-tab", "--", "C:\\Windows\\System32\\OpenSSH\\ssh.exe", "--", "studio"],
    },
  ]);
});

test("missing Windows Terminal falls back to cmd and leaves the window open", async () => {
  const calls: Array<TerminalCommand> = [];
  await openWindowsTerminal(
    ["C:\\Program Files\\Git\\usr\\bin\\ssh.exe", "--", "my host"],
    (command) => {
      calls.push(command);

      return Promise.resolve(calls.length === 2);
    },
    { ComSpec: "D:\\Windows\\System32\\cmd.exe" }
  );
  expect(calls[1]).toEqual({
    file: "D:\\Windows\\System32\\cmd.exe",
    windowsVerbatimArguments: true,
    args: [
      "/d",
      "/v:off",
      "/s",
      "/k",
      '""C:\\Program Files\\Git\\usr\\bin\\ssh.exe" "--" "my host""',
    ],
  });
});

test("terminal failures and unsafe aliases do not silently launch another command", async () => {
  expect(
    await openWindowsTerminal(["ssh", "--", "pi"], () => Promise.resolve(false)).catch(String)
  ).toContain("No Windows terminal");
  expect(
    await openWindowsTerminal(["ssh", "--", "pi"], () => Promise.reject(new Error("denied"))).catch(
      String
    )
  ).toContain("denied");

  for (const alias of ["pi&whoami", "%USERPROFILE%", 'pi"', "pi;whoami", "pi\nwhoami", "pi!x"])
    expect(() => windowsTerminalCommands(["ssh", "--", alias])).toThrow("Unsafe terminal argument");
});

test("POSIX handoff keeps its script and the configured SSH binary", () => {
  expect(sshArgv("pi", { platform: "darwin" })).toEqual(["ssh", "--", "pi"]);
  expect(sshArgv("pi", { platform: "win32", sshBinary: "custom.exe" })).toEqual([
    "custom.exe",
    "--",
    "pi",
  ]);
  expect(terminalScript(["ssh", "--", "pi"])).toContain("'ssh' '--' 'pi'");
});

const recordOpened = (opened: Array<string>) => (path: string) => {
  opened.push(path);

  return Promise.resolve("");
};

test("Linux runs a waiting script in $TERMINAL, then the usual emulators, never the editor", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "polaris-terminal-test-"));
  const calls: Array<TerminalCommand> = [];
  const opened: Array<string> = [];

  try {
    await openClientTerminal(["ssh", "--", "pi"], "linux", {
      env: { TERMINAL: "kitty" },
      openPath: recordOpened(opened),
      start: (command) => {
        calls.push(command);

        return Promise.resolve(command.file === "gnome-terminal");
      },
      tmp,
    });

    expect(opened).toEqual([]);
    expect(calls.map((c) => c.file)).toEqual(["kitty", "x-terminal-emulator", "gnome-terminal"]);
    const script = calls[2]?.args[1] ?? "";
    expect(calls[2]?.args).toEqual(["--", script]);
    expect(readFileSync(script, "utf8")).toContain("'ssh' '--' 'pi'");
    expect(readFileSync(script, "utf8")).toContain("read -r _");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Linux with no terminal emulator says so", async () => {
  expect(
    await openLinuxTerminal("/tmp/x.sh", () => Promise.resolve(false), {}).catch(String)
  ).toContain("set $TERMINAL");
  expect(linuxTerminalCommands("/s", {}).map((c) => c.file)[0]).toBe("x-terminal-emulator");
});

test("macOS still opens a .command file in Terminal", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "polaris-terminal-test-"));
  const opened: Array<string> = [];

  try {
    await openClientTerminal(["ssh", "--", "pi"], "darwin", {
      env: {},
      openPath: recordOpened(opened),
      start: () => Promise.reject(new Error("no emulator on macOS")),
      tmp,
    });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.endsWith(".command")).toBe(true);
    expect(readFileSync(opened[0] ?? "", "utf8")).not.toContain("read -r _");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

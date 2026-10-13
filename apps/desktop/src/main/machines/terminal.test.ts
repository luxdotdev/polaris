import { expect, test } from "bun:test";
import {
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

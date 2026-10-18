// Planted: programs started by a bare name, or in a cwd with no resolver. Each line is one report.
import { execFile, spawn } from "node:child_process";

const SSH = "ssh";
declare const argv: string[];
declare const binary: string;
declare const options: { cwd: string };
declare const executableOf: (name: string) => string;
declare const launchArgv: (binary: string, args: string[]) => string[];

export const planted = (cwd: string) => {
  Bun.spawn(["ssh", "-G", "host"]);
  Bun.spawnSync({ cmd: ["tar", "-xzf", "a"], cwd });
  spawn("powershell.exe", ["-NoLogo"]);
  execFile(SSH, ["-V"]);
  Bun.spawn(argv, { cwd });
  Bun.spawn([binary, "--version"], { cwd });
  Bun.spawn([...argv], options);
  spawn(binary, [], { cwd, stdio: "pipe" });
  Bun.spawn([binary], { ...options });
  Bun.which("git");
};

// Resolved, absolute, or no cwd: no report.
export const fine = (cwd: string) => {
  Bun.spawn([executableOf("ssh"), "-G", "host"], { cwd });
  Bun.spawn(launchArgv(binary, ["-p"]), { cwd });
  Bun.spawn(["/bin/sh", "-c", "true"], { cwd });
  Bun.spawn(["C:\\Windows\\System32\\cmd.exe"], { cwd });
  Bun.spawn([process.execPath, "x"], { cwd });
  Bun.spawn([binary, "--version"], { env: {} });
  spawn(executableOf(binary), [], { cwd });
};

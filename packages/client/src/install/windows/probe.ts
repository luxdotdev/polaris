/**
 * The probe for a Windows Host, run after the POSIX one finds no `sh` (or Git for
 * Windows' `sh`, whose `uname -s` says MINGW). One `-EncodedCommand`, valid in any
 * DefaultShell, which also names that shell: the PowerShell's parent process. Pure.
 */
import type { HostProbe } from "../plan.ts";
import { encodedCommand, type WindowsShell } from "./powershell.ts";

/** The Daemon a Windows Host runs, under the user's profile (S3's `installedPaths`). */
export const WINDOWS_CURRENT = String.raw`.polaris\bin\current\polaris.exe`;

/** PowerShell for the current Daemon's path, under `$env:USERPROFILE`. */
export const currentExe = `(Join-Path $env:USERPROFILE '${WINDOWS_CURRENT}')`;

const PROBE = [
  "'os=windows'",
  // A 32-bit PowerShell on 64-bit Windows sees x86 here and the truth in PROCESSOR_ARCHITEW6432.
  "$arch = $env:PROCESSOR_ARCHITEW6432; if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }; 'arch=' + $arch",
  `$parent = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $PID)).ParentProcessId`,
  "'shell=' + (Get-Process -Id $parent -ErrorAction SilentlyContinue).ProcessName",
  "'psversion=' + $PSVersionTable.PSVersion",
  `$exe = ${currentExe}`,
  "if (Test-Path -LiteralPath $exe -PathType Leaf) { $v = & $exe version 2>$null; if ($LASTEXITCODE -eq 0) { 'installed=' + $v } }",
].join("; ");

export const WINDOWS_PROBE_COMMAND = encodedCommand(PROBE);

/** Whether a POSIX probe's `uname -s` is Git for Windows', MSYS2's or Cygwin's: a Windows Host. */
export const isWindowsUname = (os: string): boolean => /^(mingw|msys|cygwin)/i.test(os.trim());

/** The DefaultShell a parent process name means; null for one we don't drive. */
export const windowsShellOf = (processName: string): WindowsShell | null => {
  const name = processName.trim().toLowerCase();

  if (name === "powershell" || name === "pwsh") return "powershell";

  return name === "cmd" ? "cmd" : null;
};

const fieldsOf = (stdout: string) =>
  new Map(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  );

/**
 * The probe's answer. A shell we don't drive leaves `windowsShell` out, which plans as
 * Unsupported; null when this isn't the Windows probe's output at all.
 */
export const parseWindowsProbe = (stdout: string): HostProbe | null => {
  const fields = fieldsOf(stdout);

  if (fields.get("os") !== "windows") return null;
  const arch = fields.get("arch") ?? "";
  const shell = windowsShellOf(fields.get("shell") ?? "");
  const version = /^polaris (\S+) (\S+)$/.exec(fields.get("installed") ?? "");

  return {
    os: "windows",
    arch,
    installed: version ? { version: version[1]!, platform: version[2]! } : null,
    // No Host-side download yet: a build that isn't bundled is fetched here and uploaded.
    tools: { fetch: null, tar: false, sha256: true },
    ...(shell === null ? { unsupportedShell: fields.get("shell") ?? "" } : { windowsShell: shell }),
  };
};

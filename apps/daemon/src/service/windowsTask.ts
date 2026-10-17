/**
 * The Windows user service: a Task Scheduler task, registered by the user for
 * the user (no administrator), that starts at logon and keeps `polaris serve`
 * running. Pure renderers; `windowsService.ts` registers and drives it (ADR 0060).
 */
import { createHash } from "node:crypto";
import { win32 } from "node:path";

/** `polaris serve` exits with this after a stop it was asked for: its supervisor must not restart it. */
export const SERVE_EXIT_STOPPED = 76;

/** A Windows path compared as Windows does: case, separators and a trailing slash don't matter. */
const canonicalPath = (path: string) =>
  win32
    .resolve(path)
    .replace(/[\\/]+$/, "")
    .toLowerCase();

export const sameWindowsPath = (a: string, b: string): boolean =>
  canonicalPath(a) === canonicalPath(b);

/**
 * The task's name: one per user and per Polaris home, since task names are
 * machine-wide. `<real profile>\.polaris` gets the plain name, any other home a
 * hash of it. `realProfile` comes from the token (`windowsProfile.ts`), never from
 * `USERPROFILE`, so a redirected home can't compute the real install's name.
 */
export const windowsTaskName = (
  user: string,
  polarisHome: string,
  realProfile: string | null
): string => {
  const safe = user.replace(/[^A-Za-z0-9._-]/g, "_");

  if (realProfile !== null && sameWindowsPath(polarisHome, win32.join(realProfile, ".polaris")))
    return `dev.lux.polaris.${safe}`;
  const digest = createHash("sha256").update(canonicalPath(polarisHome)).digest("hex").slice(0, 8);

  return `dev.lux.polaris.${safe}.${digest}`;
};

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** The Polaris home a registered task runs: its action's working directory, from `schtasks /Query /XML`. */
export const taskWorkingDirectory = (xml: string): string | null => {
  const found = /<WorkingDirectory>([^<]*)<\/WorkingDirectory>/.exec(xml);

  return found === null ? null : unescapeXml(found[1]!.trim());
};

/** The task already registered under this home's name. */
export interface ExistingTask {
  /** Its working directory, the Polaris home it runs; null for a task that isn't Polaris'. */
  readonly home: string | null;
  /** That home still has `bin\current\polaris.exe`, so the task's loop would run a Daemon. */
  readonly homeInstalled: boolean;
}

/**
 * Whose task the name holds. `ours`: it runs this home. `abandoned`: another home with
 * nothing installed, whose loop would exit at once. `taken-over`: another live home,
 * replaced because `--replace-task` said so. `conflict`: another live home; install refuses.
 */
export type TaskClaim = "absent" | "ours" | "abandoned" | "taken-over" | "conflict";

/** Pure: may an install for `home` (re)register the task `existing` describes? */
export const claimTask = (
  existing: ExistingTask | null,
  home: string,
  replace: boolean
): TaskClaim => {
  if (existing === null) return "absent";

  if (existing.home !== null && sameWindowsPath(existing.home, home)) return "ours";

  if (existing.home !== null && !existing.homeInstalled) return "abandoned";

  return replace ? "taken-over" : "conflict";
};

/**
 * On a take-over, whether to stop the other home's Daemon first: only while the task itself
 * runs, since its loop would block ours (`running` null: Task Scheduler couldn't say).
 */
export const stopsOtherHome = (
  claim: TaskClaim,
  otherHome: string | null,
  running: boolean | null
): boolean => claim === "taken-over" && otherHome !== null && running !== false;

/**
 * The supervisor loop the task runs, relative to the Polaris home (its working
 * directory), so no user path passes through cmd's parser. It runs `current`
 * afresh each time, restarts after a second, and ends on exit 75 (another
 * Daemon is running), 76 (stopped on request) or once uninstalled.
 */
export const supervisorLoop = (): string =>
  [
    '/d /q /c "for /l %i in (0,0,1) do @(',
    "(if not exist bin\\current\\polaris.exe exit 0)",
    " & bin\\current\\polaris.exe serve --home . >>logs\\daemon.out.log 2>>logs\\daemon.err.log",
    ` & (if errorlevel 75 if not errorlevel ${SERVE_EXIT_STOPPED + 1} exit 0)`,
    ' & timeout /t 1 /nobreak >nul)"',
  ].join("");

export interface TaskSpec {
  /** The user's SID: the trigger fires at their logon and the task runs as them. */
  readonly userSid: string;
  /** The Polaris home, the loop's working directory. */
  readonly polarisHome: string;
  /** `%SystemRoot%`, where conhost.exe and cmd.exe live. */
  readonly systemRoot: string;
}

const escapeXml = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * The task definition for `schtasks /Create /XML`. A headless conhost runs the
 * loop, so no console window opens and every console child shares the hidden
 * console. It runs only while the user is signed in, unelevated, with no time
 * limit, on battery too, and never twice at once.
 */
export const taskXml = (spec: TaskSpec): string => {
  const system32 = win32.join(spec.systemRoot, "System32");
  const cmd = win32.join(system32, "cmd.exe");
  const args = `--headless ${cmd} ${supervisorLoop()}`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the Polaris Daemon while you are signed in.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escapeXml(spec.userSid)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(spec.userSid)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(win32.join(system32, "conhost.exe"))}</Command>
      <Arguments>${escapeXml(args)}</Arguments>
      <WorkingDirectory>${escapeXml(spec.polarisHome)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
};

/** The file `schtasks /XML` reads: UTF-16 LE with a byte-order mark, as its declaration says. */
export const taskXmlBytes = (xml: string): Uint8Array => {
  const body = Buffer.from(xml, "utf16le");

  return Buffer.concat([Buffer.from([0xff, 0xfe]), body]);
};

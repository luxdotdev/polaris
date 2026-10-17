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

const elementText = (xml: string, name: string): string | null => {
  const found = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);

  return found === null ? null : unescapeXml(found[1]!.trim());
};

/** The Polaris home a registered task runs: its action's working directory, from `schtasks /Query /XML`. */
export const taskWorkingDirectory = (xml: string): string | null =>
  elementText(xml, "WorkingDirectory");

/**
 * A local absolute drive path such as `C:\Users\lucas\.polaris`: no UNC share, no `\\?\`
 * or `\\.\` device path, no stream. A task's home must be one before any file call touches it.
 * Off Windows (tests on another OS) an absolute POSIX path stands in for one.
 */
export const isLocalDrivePath = (path: string, os: string = process.platform): boolean =>
  os === "win32"
    ? /^[A-Za-z]:[\\/]/.test(path) && !path.slice(2).includes(":")
    : path.startsWith("/");

/** The one program a task runs. */
export interface TaskAction {
  readonly command: string;
  readonly arguments: string;
}

/** What a definition says: its principal's UserId, and its action when it has exactly one. */
export interface RegisteredTask {
  /** Task Scheduler gives back the SID install registered, e.g. `S-1-5-21-…-1001`. */
  readonly principal: string | null;
  readonly action: TaskAction | null;
  /** That action's working directory. */
  readonly workingDirectory: string | null;
}

/** Pure: reads a definition as `schtasks /Query /XML` prints it. */
export const readTask = (xml: string): RegisteredTask => {
  const principal = /<Principal\b[^>]*>([\s\S]*?)<\/Principal>/.exec(xml)?.[1] ?? "";
  const actions = /<Actions\b[^>]*>([\s\S]*?)<\/Actions>/.exec(xml)?.[1] ?? "";
  const single = actions.match(/<(Exec|ComHandler|SendEmail|ShowMessage)\b/g)?.length === 1;
  const command = single ? elementText(actions, "Command") : null;

  return {
    principal: elementText(principal, "UserId"),
    action:
      command === null ? null : { command, arguments: elementText(actions, "Arguments") ?? "" },
    workingDirectory: command === null ? null : elementText(actions, "WorkingDirectory"),
  };
};

/**
 * `current`: the action `taskXml` writes now. `older`: a Polaris supervisor loop that
 * another definition wrote (a pre-release's), so it is registered again. `other`: not Polaris'.
 */
export type ActionKind = "current" | "older" | "other";

const POLARIS_LOOP = /\bbin\\current\\polaris\.exe serve\b/i;

export const actionKind = (found: TaskAction | null, expected: TaskAction): ActionKind => {
  if (found === null) return "other";

  const sameArguments = found.arguments.toLowerCase() === expected.arguments.toLowerCase();

  if (sameWindowsPath(found.command, expected.command) && sameArguments) return "current";
  const program = win32.basename(found.command).toLowerCase();
  const loopHost = program === "conhost.exe" || program === "cmd.exe";

  return loopHost && POLARIS_LOOP.test(found.arguments) ? "older" : "other";
};

/** The task already registered under this home's name. */
export interface ExistingTask {
  /** Its action against the one this install writes; `other` too when it runs as another account. */
  readonly action: ActionKind;
  /**
   * The Polaris home it runs: its working directory, but only for this user's Polaris
   * task and a local drive path; null otherwise.
   */
  readonly home: string | null;
  /** That home still has `bin\current\polaris.exe`, so the task's loop would run a Daemon. */
  readonly homeInstalled: boolean;
}

/** A task under the name that Task Scheduler won't show this user, as another account's. */
export const UNREADABLE_TASK: ExistingTask = { action: "other", home: null, homeInstalled: false };

/**
 * Pure: a registered task as this user's install sees it. A task that runs as another
 * account or runs something else has no home, whatever its working directory says.
 */
export const describeTask = (
  task: RegisteredTask,
  userSid: string,
  expected: TaskAction,
  os: string = process.platform
): Omit<ExistingTask, "homeInstalled"> => {
  const asThisUser = task.principal?.toUpperCase() === userSid.toUpperCase();
  const action = asThisUser ? actionKind(task.action, expected) : "other";
  const directory = task.workingDirectory;
  const local = directory !== null && isLocalDrivePath(directory, os);

  return { action, home: action !== "other" && local ? directory : null };
};

/**
 * Whose task the name holds. `ours`: this user's, for this home, as install writes it.
 * `stale`: the same from an older definition, registered again. `abandoned`: this user's
 * for another home with nothing installed, whose loop would exit at once. Anything else is
 * a `conflict` and install refuses, or `taken-over` when `--replace-task` said so.
 */
export type TaskClaim = "absent" | "ours" | "stale" | "abandoned" | "taken-over" | "conflict";

/** Pure: may an install for `home` (re)register the task `existing` describes? */
export const claimTask = (
  existing: ExistingTask | null,
  home: string,
  replace: boolean
): TaskClaim => {
  if (existing === null) return "absent";

  if (existing.home !== null && sameWindowsPath(existing.home, home))
    return existing.action === "current" ? "ours" : "stale";

  if (existing.home !== null && !existing.homeInstalled) return "abandoned";

  return replace ? "taken-over" : "conflict";
};

/** This user's own task for this home, current or stale: install replaces it, uninstall deletes it. */
export const isOwnClaim = (claim: TaskClaim): boolean => claim === "ours" || claim === "stale";

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

/** A headless conhost runs the loop, so no console window opens. */
export const taskAction = (systemRoot: string): TaskAction => {
  const system32 = win32.join(systemRoot, "System32");

  return {
    command: win32.join(system32, "conhost.exe"),
    arguments: `--headless ${win32.join(system32, "cmd.exe")} ${supervisorLoop()}`,
  };
};

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
  const action = taskAction(spec.systemRoot);

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
      <Command>${escapeXml(action.command)}</Command>
      <Arguments>${escapeXml(action.arguments)}</Arguments>
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

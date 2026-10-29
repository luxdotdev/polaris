/**
 * Which service manager keeps a Host's Daemon running, found with one `sh` probe, and
 * the command that restarts it there: `launchctl kickstart -k`, `systemctl --user restart`,
 * Polaris' own supervisor, or the Windows logon task through `polaris.exe install --restart`.
 * Pure but for the probe's text. See docs/adr/0086-restart-runs-from-the-client-through-the-service-manager.md.
 */
import { LAUNCHD_LABEL, SYSTEMD_UNIT } from "@polaris/protocol/endpoint";
import { Data, Match, Schema } from "effect";
import { shScript } from "../install/Ssh.ts";
import { restartCommand as windowsRestartCommand } from "../install/windows/scripts.ts";

/** The service manager's name, for the UI's copy ("launchd started it again"). */
export const ServiceManager = Schema.Literals([
  "launchd",
  "systemd",
  "supervisor",
  "task-scheduler",
]);

export type ServiceManager = typeof ServiceManager.Type;

export type DaemonService = Data.TaggedEnum<{
  /** A LaunchAgent loaded in `gui/<uid>` or `user/<uid>`. */
  Launchd: { readonly uid: string; readonly domain: "gui" | "user" };
  Systemd: Record<never, never>;
  /** Polaris' own supervisor, on a Linux Host without a `systemd --user` bus. */
  Supervisor: Record<never, never>;
  /** The per-user logon task (ADR 0060). */
  TaskScheduler: Record<never, never>;
}>;

export const DaemonService = Data.taggedEnum<DaemonService>();

const POLARIS = '"$HOME/.polaris"';

/** One round trip: the OS, and which service holds the Daemon there. */
export const SERVICE_PROBE = [
  `printf 'os=%s\\n' "$(uname -s)"`,
  `uid=$(id -u); printf 'uid=%s\\n' "$uid"`,
  `if [ "$(uname -s)" = Darwin ]; then for d in gui user; do launchctl print "$d/$uid/${LAUNCHD_LABEL}" >/dev/null 2>&1 && { printf 'launchd=%s\\n' "$d"; break; }; done; ` +
    `else systemctl --user is-enabled --quiet ${SYSTEMD_UNIT} >/dev/null 2>&1 && echo systemd=1; ` +
    `[ -x ${POLARIS}/bin/polaris-supervise ] && echo supervisor=1; fi`,
  "exit 0",
].join("; ");

const fieldsOf = (stdout: string) =>
  new Map(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
  );

/** The service the probe found; null when none holds the Daemon (Reinstall service). */
export const parseServiceProbe = (stdout: string): DaemonService | null => {
  const fields = fieldsOf(stdout);
  const domain = fields.get("launchd");
  const uid = fields.get("uid") ?? "";

  if (domain === "gui" || domain === "user") return DaemonService.Launchd({ uid, domain });

  if (fields.get("systemd") === "1") return DaemonService.Systemd();

  if (fields.get("supervisor") === "1") return DaemonService.Supervisor();

  return null;
};

export const serviceManagerOf = (service: DaemonService): ServiceManager =>
  DaemonService.$match(service, {
    Launchd: () => "launchd" as const,
    Systemd: () => "systemd" as const,
    Supervisor: () => "supervisor" as const,
    TaskScheduler: () => "task-scheduler" as const,
  });

/** What runs on the Host, and the same as the user would type it ("Copy command"). */
export interface RestartCommand {
  readonly manager: ServiceManager;
  /** The exact command, for "Copy command" and the failure's well. */
  readonly display: string;
  /** What the Host channel runs: `sh -c '…'`, or a Windows `-EncodedCommand` line. */
  readonly line: string;
}

/**
 * The supervisor restarts `polaris serve` a second after it exits; with no supervisor
 * running, wait for the old Daemon to let go of its lock, then start one.
 */
const SUPERVISOR_RESTART = [
  `p=$(cat ${POLARIS}/daemon.pid 2>/dev/null)`,
  `if [ -n "$p" ]; then kill "$p" || exit $?; i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i+1)); done; fi`,
  `${POLARIS}/bin/polaris-supervise`,
].join("; ");

/** The restart command for `service`; the logon task's line is PowerShell, valid in any DefaultShell. */
export const restartCommandFor = (service: DaemonService): RestartCommand =>
  Match.value(service).pipe(
    Match.tagsExhaustive({
      Launchd: ({ uid, domain }) => {
        const display = `launchctl kickstart -k ${domain}/${uid}/${LAUNCHD_LABEL}`;

        return { manager: "launchd" as const, display, line: shScript(display) };
      },
      Systemd: () => {
        const display = `systemctl --user restart ${SYSTEMD_UNIT}`;

        return { manager: "systemd" as const, display, line: shScript(display) };
      },
      Supervisor: () => ({
        manager: "supervisor" as const,
        display: SUPERVISOR_RESTART,
        line: shScript(SUPERVISOR_RESTART),
      }),
      TaskScheduler: () => ({
        manager: "task-scheduler" as const,
        display: "%USERPROFILE%\\.polaris\\bin\\current\\polaris.exe install --restart --json",
        line: windowsRestartCommand(),
      }),
    })
  );

/** The service manager's own word that it has no such service: "Reinstall service" applies. */
export const missingService = (manager: ServiceManager, output: string, code: number): boolean =>
  Match.value(manager).pipe(
    // launchctl exits 113 ("Could not find service") for a label it doesn't have.
    Match.when("launchd", () => code === 113 || /could not find service/i.test(output)),
    Match.when("systemd", () => /not found|not loaded|no such file/i.test(output)),
    Match.when("supervisor", () => /no such file|not found/i.test(output)),
    Match.orElse(() => false)
  );

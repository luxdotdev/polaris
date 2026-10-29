import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonService,
  missingService,
  parseServiceProbe,
  restartCommandFor,
  SERVICE_PROBE,
} from "./service.ts";

const posix = process.platform === "win32" ? test.skip : test;

/** Runs the probe in a local `sh` whose `uname`, `id`, `launchctl` and `systemctl` are stand-ins. */
const probeWith = (tools: Record<string, string>, supervisor = false) => {
  const root = mkdtempSync(join(tmpdir(), "restart-probe-"));
  const bin = join(root, "bin");
  mkdirSync(bin);

  for (const [name, body] of Object.entries({ id: "echo 501", ...tools })) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  }

  if (supervisor) {
    mkdirSync(join(root, ".polaris", "bin"), { recursive: true });
    writeFileSync(join(root, ".polaris", "bin", "polaris-supervise"), "#!/bin/sh\n");
    chmodSync(join(root, ".polaris", "bin", "polaris-supervise"), 0o755);
  }

  const ran = spawnSync("/bin/sh", ["-c", SERVICE_PROBE], {
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
    encoding: "utf8",
  });

  return parseServiceProbe(ran.stdout);
};

describe("the service probe", () => {
  posix("macOS: the domain the LaunchAgent is loaded in, gui before user", () => {
    expect(
      probeWith({
        uname: "echo Darwin",
        launchctl: '[ "$2" = "user/501/dev.lux.polaris" ]',
      })
    ).toEqual(DaemonService.Launchd({ uid: "501", domain: "user" }));
    expect(probeWith({ uname: "echo Darwin", launchctl: "exit 0" })).toEqual(
      DaemonService.Launchd({ uid: "501", domain: "gui" })
    );
  });

  posix(
    "Linux: systemd --user when the unit is enabled, else Polaris' supervisor, else none",
    () => {
      expect(
        probeWith({
          uname: "echo Linux",
          systemctl: '[ "$1 $2 $3" = "--user is-enabled --quiet" ] && [ "$4" = polaris.service ]',
        })
      ).toEqual(DaemonService.Systemd());
      expect(probeWith({ uname: "echo Linux", systemctl: "exit 1" }, true)).toEqual(
        DaemonService.Supervisor()
      );
      expect(probeWith({ uname: "echo Linux", systemctl: "exit 1" })).toBeNull();
    }
  );

  posix("macOS with nothing loaded has no service", () => {
    expect(probeWith({ uname: "echo Darwin", launchctl: "exit 113" })).toBeNull();
  });
});

describe("restartCommandFor", () => {
  test("each service manager's own restart, exactly as the user would type it", () => {
    expect(restartCommandFor(DaemonService.Launchd({ uid: "501", domain: "gui" })).display).toBe(
      "launchctl kickstart -k gui/501/dev.lux.polaris"
    );
    expect(restartCommandFor(DaemonService.Systemd()).display).toBe(
      "systemctl --user restart polaris.service"
    );
    expect(restartCommandFor(DaemonService.TaskScheduler()).display).toBe(
      "%USERPROFILE%\\.polaris\\bin\\current\\polaris.exe install --restart --json"
    );
  });

  test("the logon task's line is PowerShell, never sh", () => {
    const line = restartCommandFor(DaemonService.TaskScheduler()).line;
    expect(line).toContain("-EncodedCommand");
    expect(line).not.toContain("sh -c");
  });

  posix("the supervisor's restart kills the recorded Daemon and starts the supervisor", () => {
    const root = mkdtempSync(join(tmpdir(), "restart-supervisor-"));
    mkdirSync(join(root, ".polaris", "bin"), { recursive: true });

    const sleeper = spawnSync("/bin/sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], {
      encoding: "utf8",
    });

    const pid = sleeper.stdout.trim();
    writeFileSync(join(root, ".polaris", "daemon.pid"), pid);
    const started = join(root, "started");
    writeFileSync(
      join(root, ".polaris", "bin", "polaris-supervise"),
      `#!/bin/sh\ntouch ${started}\n`
    );
    chmodSync(join(root, ".polaris", "bin", "polaris-supervise"), 0o755);

    const ran = spawnSync(
      "/bin/sh",
      ["-c", restartCommandFor(DaemonService.Supervisor()).display],
      { env: { PATH: "/usr/bin:/bin", HOME: root }, encoding: "utf8" }
    );

    expect(ran.status).toBe(0);
    expect(spawnSync("kill", ["-0", pid]).status).not.toBe(0);
    expect(spawnSync("test", ["-e", started]).status).toBe(0);
  });
});

test("Reinstall service applies when the service manager has no such service", () => {
  expect(missingService("launchd", 'Could not find service "dev.lux.polaris"', 113)).toBe(true);
  expect(
    missingService(
      "systemd",
      "Failed to restart polaris.service: Unit polaris.service not found.",
      5
    )
  ).toBe(true);
  expect(
    missingService(
      "systemd",
      "Job for polaris.service failed because the control process exited",
      1
    )
  ).toBe(false);
  expect(missingService("task-scheduler", "anything", 1)).toBe(false);
});

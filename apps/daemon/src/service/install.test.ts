import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import {
  defaultStateFile,
  isOurAppServer,
  makeAppServer,
  readAppServerState,
} from "../harness/codex/AppServer.ts";
import { makeFakeCodex } from "../harness/codex/testing/fakeCodex.ts";
import { type CommandResult, CommandRunner } from "./CommandRunner.ts";
import {
  type InstallContext,
  install,
  layout,
  planLinuxService,
  sha256File,
  uninstall,
} from "./install.ts";

/** A scripted service manager: records every command, answers from `respond`. */
const fakeRunner = (
  respond: (argv: ReadonlyArray<string>) => Partial<CommandResult> = () => ({})
) => {
  const calls: Array<string> = [];
  /** stdin passed to each command, by its joined argv (last one wins). */
  const stdin = new Map<string, string>();
  const layer = Layer.succeed(
    CommandRunner,
    CommandRunner.of({
      run: (argv, options) =>
        Effect.sync(() => {
          calls.push(argv.join(" "));
          if (options?.stdin !== undefined) stdin.set(argv.join(" "), options.stdin);
          return { code: 0, stdout: "", stderr: "", ...respond(argv) };
        }),
    })
  );
  return { calls, stdin, layer };
};

let root: string;
let source: string;
const ctx = (os: InstallContext["os"]): InstallContext => ({
  os,
  polarisHome: join(root, ".polaris"),
  userHome: root,
  xdgConfigHome: null,
  uid: 501,
  user: "ada",
  path: "/usr/bin:/bin",
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "polaris-install-"));
  source = join(root, "polaris-upload");
  writeFileSync(source, "#!/bin/sh\necho polaris 1.2.3 darwin-arm64\n");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("install on macOS", () => {
  test("lays out the binary, links current and bootstraps the LaunchAgent", async () => {
    // Not loaded yet: `launchctl print` fails in both domains.
    const runner = fakeRunner((argv) => (argv[1] === "print" ? { code: 113 } : {}));
    const report = await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    const paths = layout(ctx("darwin"), "1.2.3");
    expect(readFileSync(paths.installed!, "utf8")).toBe(readFileSync(source, "utf8"));
    expect(readlinkSync(paths.current)).toBe("1.2.3");
    expect(report.notes).toEqual([]);
    expect(report.sha256).toBe(sha256File(source));
    expect(report.serviceFile).toBe(join(root, "Library/LaunchAgents/dev.lux.polaris.plist"));
    expect(readFileSync(report.serviceFile, "utf8")).toContain(
      `${join(root, ".polaris/bin/current/polaris")}</string>`
    );
    expect(report.serviceDomain).toBe("gui/501");
    expect(runner.calls).toContain(`launchctl bootstrap gui/501 ${report.serviceFile}`);
    expect(runner.calls).toContain("launchctl kickstart gui/501/dev.lux.polaris");
    expect(report.linger).toBe("not-applicable");
  });

  test("is idempotent: a second run changes and restarts nothing", async () => {
    const first = fakeRunner((argv) => (argv[1] === "print" ? { code: 113 } : {}));
    await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(first.layer))
    );
    const second = fakeRunner(); // now loaded
    const report = await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(second.layer))
    );
    expect(report.binaryChanged).toBe(false);
    expect(report.serviceFileChanged).toBe(false);
    expect(report.restarted).toBe(false);
    expect(second.calls).toEqual([
      "launchctl print gui/501/dev.lux.polaris",
      "launchctl kickstart gui/501/dev.lux.polaris",
    ]);
  });

  test("a new version restarts the loaded service in place", async () => {
    const first = fakeRunner((argv) => (argv[1] === "print" ? { code: 113 } : {}));
    await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(first.layer))
    );
    writeFileSync(source, "#!/bin/sh\necho polaris 1.3.0 darwin-arm64\n");
    const second = fakeRunner();
    const report = await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.3.0" }).pipe(Effect.provide(second.layer))
    );
    expect(report.restarted).toBe(true);
    expect(readlinkSync(layout(ctx("darwin")).current)).toBe("1.3.0");
    expect(second.calls).toContain("launchctl kickstart -k gui/501/dev.lux.polaris");
  });

  test("falls back to the user domain without a GUI login", async () => {
    const runner = fakeRunner((argv) => {
      if (argv[1] === "print") return { code: 113 };
      if (argv[1] === "bootstrap" && argv[2] === "gui/501")
        return { code: 5, stderr: "Bootstrap failed: 5: Input/output error" };
      return {};
    });
    const report = await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    expect(report.serviceDomain).toBe("user/501");
    expect(report.notes.join("\n")).toContain("No GUI login session");
  });
});

describe("install on Linux", () => {
  test("writes the unit, enables it and enables linger", async () => {
    const runner = fakeRunner((argv) =>
      argv[0] === "loginctl" && argv[1] === "show-user" ? { stdout: "no\n" } : {}
    );
    const report = await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    expect(report.serviceFile).toBe(join(root, ".config/systemd/user/polaris.service"));
    expect(runner.calls).toContain("systemctl --user daemon-reload");
    expect(runner.calls).toContain("systemctl --user enable polaris.service");
    expect(runner.calls).toContain("loginctl enable-linger ada");
    expect(report.linger).toBe("enabled");
  });

  test("reports clearly when linger needs an administrator", async () => {
    const runner = fakeRunner((argv) => {
      if (argv[0] === "loginctl" && argv[1] === "show-user") return { stdout: "no\n" };
      if (argv[0] === "loginctl") return { code: 1, stderr: "Access denied" };
      return {};
    });
    const report = await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    expect(report.linger).toBe("needs-admin");
    expect(report.notes.join("\n")).toContain("sudo loginctl enable-linger ada");
  });

  test("reports systemd as the supervisor", async () => {
    const report = await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(fakeRunner().layer))
    );
    expect(report).toMatchObject({ supervisor: "systemd", autostart: [] });
  });
});

describe("install on Linux without systemd --user", () => {
  test("planLinuxService", () => {
    expect(planLinuxService({ userSystemd: true, crontab: "available" })).toEqual({
      supervisor: "systemd",
      autostart: [],
    });
    expect(planLinuxService({ userSystemd: false, crontab: "available" })).toEqual({
      supervisor: "fallback",
      autostart: ["cron", "profile"],
    });
    expect(planLinuxService({ userSystemd: false, crontab: "missing" })).toEqual({
      supervisor: "fallback",
      autostart: ["profile"],
    });
    expect(planLinuxService({ userSystemd: false, crontab: "denied" }).autostart).toEqual([
      "profile",
    ]);
  });

  /** No user bus; `crontab` answers from `cron` (null: not installed). */
  const noBus = (cron: { current: string | null }) =>
    fakeRunner((argv) => {
      if (argv[0] === "systemctl")
        return { code: 1, stderr: "Failed to connect to bus: No medium found" };
      if (argv[0] === "crontab" && argv[1] === "-l") {
        if (cron.current === null) return { code: 127, stderr: "not found" };
        return cron.current === ""
          ? { code: 1, stderr: "no crontab for ada" }
          : { stdout: cron.current };
      }
      return {};
    });

  test("installs the fallback supervisor with cron @reboot and a profile hook, idempotently", async () => {
    const cron = { current: "" as string | null };
    writeFileSync(join(root, ".profile"), "export EDITOR=vi\n");
    const runner = noBus(cron);
    const report = await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    const script = layout(ctx("linux")).supervisor;
    expect(report).toMatchObject({
      supervisor: "fallback",
      autostart: ["cron", "profile"],
      serviceFile: script,
      serviceDomain: "polaris-supervisor",
      linger: "not-applicable",
    });
    expect(report.notes[0]).toContain("No systemd user bus on this Host (Failed to connect to bus");
    expect(readFileSync(script, "utf8")).toContain("polaris serve exited");
    expect(runner.calls).toContain(script); // started
    expect(runner.calls.some((c) => c.startsWith("systemctl --user enable"))).toBe(false);
    const crontab = runner.stdin.get("crontab -")!;
    expect(crontab).toBe(`@reboot '${script}' # polaris-supervisor\n`);
    const profile = readFileSync(join(root, ".profile"), "utf8");
    expect(profile).toBe(
      `export EDITOR=vi\n[ -x '${script}' ] && '${script}' >/dev/null 2>&1 # polaris-supervisor\n`
    );

    // Again: the crontab already has the line, the profile is unchanged.
    cron.current = crontab;
    const again = noBus(cron);
    await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(again.layer))
    );
    expect(again.calls).not.toContain("crontab -");
    expect(readFileSync(join(root, ".profile"), "utf8")).toBe(profile);
  });

  test("without crontab it says the Daemon won't start at boot", async () => {
    const report = await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(
        Effect.provide(noBus({ current: null }).layer)
      )
    );
    expect(report.autostart).toEqual(["profile"]);
    expect(report.notes.join("\n")).toContain("does not start at boot");
  });

  test("uninstall removes the cron and profile lines and keeps the user's own", async () => {
    const cron = { current: "0 * * * * backup\n" as string | null };
    const runner = noBus(cron);
    await Effect.runPromise(
      install(ctx("linux"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    cron.current = runner.stdin.get("crontab -")!;
    expect(cron.current).toContain("0 * * * * backup\n@reboot");
    const removal = noBus(cron);
    await Effect.runPromise(
      uninstall(ctx("linux"), { purge: false }).pipe(Effect.provide(removal.layer))
    );
    expect(removal.stdin.get("crontab -")).toBe("0 * * * * backup\n");
    expect(readFileSync(join(root, ".profile"), "utf8")).not.toContain("polaris-supervisor");
  });
});

describe("uninstall", () => {
  test("removes the service and binaries but keeps state", async () => {
    const runner = fakeRunner((argv) => (argv[1] === "print" ? { code: 113 } : {}));
    await Effect.runPromise(
      install(ctx("darwin"), { source, version: "1.2.3" }).pipe(Effect.provide(runner.layer))
    );
    const state = join(root, ".polaris", "state.sqlite");
    writeFileSync(state, "");
    const report = await Effect.runPromise(
      uninstall(ctx("darwin"), { purge: false }).pipe(Effect.provide(runner.layer))
    );
    expect(report.serviceFileRemoved).toBe(true);
    expect(existsSync(layout(ctx("darwin")).bin)).toBe(false);
    expect(existsSync(state)).toBe(true);
    // And again: nothing left to do, still succeeds.
    const again = await Effect.runPromise(
      uninstall(ctx("darwin"), { purge: true }).pipe(Effect.provide(runner.layer))
    );
    expect(again.serviceFileRemoved).toBe(false);
    expect(existsSync(join(root, ".polaris"))).toBe(false);
  });

  test("stops the shared Codex app-server, which otherwise outlives the Daemon", async () => {
    // Short paths: the socket must fit the Unix socket path limit.
    root = mkdtempSync("/tmp/pun-");
    const home = join(root, ".polaris");
    const socketPath = join(home, "codex.sock");
    const codex = makeFakeCodex(root);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* makeAppServer({
            codexPath: codex.path,
            socketPath,
            spawn: true,
            systemdRun: null,
          });
          yield* server.connect;
        })
      )
    );
    const pid = readAppServerState(defaultStateFile(socketPath))!.pid;
    expect(isOurAppServer(pid, socketPath)).toBe(true);
    const report = await Effect.runPromise(
      uninstall(ctx("darwin"), { purge: false }).pipe(Effect.provide(fakeRunner().layer))
    );
    expect(report.codexAppServerStopped).toBe(pid);
    expect(isOurAppServer(pid, socketPath)).toBe(false);
  }, 20_000);
});

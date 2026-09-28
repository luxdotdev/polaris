/**
 * The fallback supervisor script (templates.ts `supervisorScript`), run for
 * real with /bin/sh against a stand-in `polaris serve`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shQuote, supervisorScript, supervisorStartLine } from "./templates.ts";

let root: string;

afterEach(() => {
  // Stop anything a test left running.
  for (const file of ["supervisor.pid", "daemon.pid"]) {
    try {
      process.kill(Number(readFileSync(join(root, file), "utf8")), "SIGKILL");
    } catch {}
  }

  rmSync(root, { recursive: true, force: true });
});

const waitFor = async (condition: () => boolean, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await Bun.sleep(25);
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

/**
 * A home with a fake `polaris` that logs each start to `starts` and then
 * behaves as `behaviour` says (per start number): "crash" exits 1, "busy"
 * exits 75 (another Daemon runs), anything else stays up.
 */
const setup = (behaviour: string) => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "polaris-sup-")));
  const program = join(root, "polaris");
  writeFileSync(
    program,
    `#!/bin/sh
echo $$ >>${shQuote(join(root, "starts"))}
echo $$ >${shQuote(join(root, "daemon.pid"))}
n=$(wc -l <${shQuote(join(root, "starts"))} | tr -d ' ')
case "$(echo ${shQuote(behaviour)} | cut -d, -f"$n")" in
  crash) exit 1 ;;
  busy) exit 75 ;;
  *) exec sleep 300 ;;
esac
`
  );
  chmodSync(program, 0o755);
  const script = join(root, "polaris-supervise");
  writeFileSync(
    script,
    supervisorScript({
      program,
      args: ["serve"],
      home: root,
      logDir: join(root, "logs"),
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    })
  );
  chmodSync(script, 0o755);

  const starts = () =>
    existsSync(join(root, "starts"))
      ? readFileSync(join(root, "starts"), "utf8").trim().split("\n").map(Number)
      : [];

  const supervisorPid = () => {
    try {
      return Number(readFileSync(join(root, "supervisor.pid"), "utf8"));
    } catch {
      return null;
    }
  };

  const launch = () => Bun.spawnSync([script]).exitCode;

  return { program, script, starts, supervisorPid, launch };
};

describe("fallback supervisor", () => {
  test("detaches, runs the Daemon, and restarts it after a crash", async () => {
    const sup = setup("crash,up");
    expect(sup.launch()).toBe(0); // returns at once
    await waitFor(() => sup.starts().length >= 2);
    const [, daemon] = sup.starts();
    expect(alive(daemon!)).toBe(true);
    // A second launch (cron, profile, reinstall) is a no-op: still one Daemon.
    expect(sup.launch()).toBe(0);
    await Bun.sleep(300);
    expect(sup.starts()).toHaveLength(2);
    expect(readFileSync(join(root, "logs", "supervisor.log"), "utf8")).toContain(
      "polaris serve exited 1"
    );
  }, 20_000);

  test("SIGTERM stops the supervisor and its Daemon", async () => {
    const sup = setup("up");
    sup.launch();
    await waitFor(() => sup.starts().length === 1 && sup.supervisorPid() !== null);
    const supervisor = sup.supervisorPid()!;
    const daemon = sup.starts()[0]!;
    process.kill(supervisor, "SIGTERM");
    await waitFor(() => !alive(supervisor) && !alive(daemon));
    expect(existsSync(join(root, "supervisor.pid"))).toBe(false);
  }, 20_000);

  test("gives up when another Daemon already holds the lock (exit 75)", async () => {
    const sup = setup("busy");
    sup.launch();
    await waitFor(() => sup.starts().length === 1);
    await waitFor(() => !existsSync(join(root, "supervisor.pid")));
    await Bun.sleep(1500);
    expect(sup.starts()).toHaveLength(1);
  }, 20_000);

  test("start lines for cron and login profiles", () => {
    expect(supervisorStartLine("/home/a b/.polaris/bin/polaris-supervise", "cron")).toBe(
      "@reboot '/home/a b/.polaris/bin/polaris-supervise' # polaris-supervisor"
    );
    expect(supervisorStartLine("/h/s", "profile")).toBe(
      "[ -x '/h/s' ] && '/h/s' >/dev/null 2>&1 # polaris-supervisor"
    );
  });
});

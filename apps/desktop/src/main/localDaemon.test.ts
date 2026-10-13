import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  awaitInstalledDaemon,
  localHostEnabled,
  resolveLocalDaemon,
  startDevDaemon,
} from "./localDaemon.ts";

test("Windows cannot enable a local Host, including a persisted true preference", () => {
  for (const enabled of [undefined, false, true])
    expect(localHostEnabled(enabled, "win32")).toBe(false);

  for (const platform of ["darwin", "linux"] as const) {
    expect(localHostEnabled(undefined, platform)).toBe(true);
    expect(localHostEnabled(true, platform)).toBe(true);
    expect(localHostEnabled(false, platform)).toBe(false);
  }
});

test("Windows rejects local sockets and dev starts before accessing either", async () => {
  for (const dev of [true, false]) {
    const options = {
      platform: "win32",
      dev,
      repoRoot: "/nonexistent",
      env: { POLARIS_DESKTOP_LOCAL_SOCKET: "/nonexistent/daemon.sock" },
    } as const;

    expect(await resolveLocalDaemon(options).catch(String)).toContain(
      "A local Windows Daemon is not supported."
    );
    expect(await startDevDaemon(options).catch(String)).toContain(
      "A local Windows Daemon is not supported."
    );
  }
});

test("POSIX explicit local sockets retain the existing behavior", async () => {
  for (const platform of ["darwin", "linux"] as const) {
    const local = await resolveLocalDaemon({
      platform,
      dev: false,
      repoRoot: "/nonexistent",
      env: {
        POLARIS_DESKTOP_LOCAL_SOCKET: "/test/daemon.sock",
        POLARIS_DESKTOP_LOCAL_HOME: "/test/home",
      },
    });

    expect(local.socketPath).toBe("/test/daemon.sock");
    expect(local.installedHome).toBe("/test/home");
  }
});

test("waiting for an installed Daemon that never listens says what its log says", async () => {
  const home = mkdtempSync(join(tmpdir(), "polaris-await-"));

  try {
    mkdirSync(join(home, ".polaris", "bin", "current"), { recursive: true });
    writeFileSync(join(home, ".polaris", "bin", "current", "polaris"), "");
    mkdirSync(join(home, ".polaris", "logs"), { recursive: true });
    writeFileSync(join(home, ".polaris", "logs", "daemon.err.log"), "dyld: Library not loaded\n");
    const failed = await awaitInstalledDaemon(join(home, "daemon.sock"), home, 300).catch(String);

    expect(failed).toContain("the daemon didn't start listening within 0.3 s");
    expect(failed).toContain("dyld: Library not loaded");
    expect(failed).not.toContain("\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

/** A shell resolves the installed command through the same `current` swap as a Daemon Upgrade. */
import { afterEach, beforeEach, expect } from "bun:test";
import { mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Effect, Layer } from "effect";
import { CommandRunner } from "./CommandRunner.ts";
import { install, pointCurrentAt, stageBinary, uninstall, type InstallContext } from "./install.ts";
import { inspectCommand, commandTarget, userCommandPath } from "../install/command.ts";
import { posixTest } from "../platform/testing.ts";

const posix = posixTest("POSIX command symlinks and a new login shell");

let home: string;

let ctx: InstallContext;

let source: string;

const runner = Layer.succeed(
  CommandRunner,
  CommandRunner.of({
    run: (argv) => Effect.succeed({ code: argv[1] === "print" ? 113 : 0, stdout: "", stderr: "" }),
  })
);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polaris-command-service-"));
  source = join(home, "upload");
  writeFileSync(source, "#!/bin/sh\necho first-version\n");
  ctx = {
    os: "darwin",
    polarisHome: join(home, ".polaris"),
    userHome: home,
    xdgConfigHome: null,
    uid: 501,
    user: "ada",
    path: `${home}/.local/bin:/usr/bin:/bin`,
    launchdLabel: "dev.lux.polaris.test",
  };
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const run = <A>(effect: Effect.Effect<A, unknown, CommandRunner>) =>
  Effect.runPromise(effect.pipe(Effect.provide(runner)));

const shell = () =>
  spawnSync("/bin/sh", ["-lc", `PATH='${ctx.path}'; command -v polaris; polaris version`], {
    encoding: "utf8",
  });

for (const os of ["darwin", "linux"] as const) {
  posix(
    `${os} install links idempotently, a new shell resolves it, upgrade follows current, uninstall removes it`,
    async () => {
      ctx = { ...ctx, os };
      await run(install(ctx, { source, version: "1.0.0", command: true }));
      await run(install(ctx, { source, version: "1.0.0", command: true }));
      expect(shell().stdout.trim().split("\n")).toEqual([userCommandPath(home), "first-version"]);
      expect(readlinkSync(userCommandPath(home))).toBe(commandTarget(ctx.polarisHome));
      writeFileSync(source, "#!/bin/sh\necho second-version\n");
      await run(stageBinary(ctx, { source, version: "2.0.0" }));
      await run(pointCurrentAt(ctx, "2.0.0"));
      expect(shell().stdout).toContain("second-version");
      await run(uninstall(ctx, { purge: false }));
      expect(
        inspectCommand(userCommandPath(home), commandTarget(ctx.polarisHome), ctx.path).state
      ).toBe("absent");
    }
  );
}

posix("Desktop's service install leaves the local command choice alone", async () => {
  await run(install(ctx, { source, version: "1.0.0" }));
  expect(
    inspectCommand(userCommandPath(home), commandTarget(ctx.polarisHome), ctx.path).state
  ).toBe("absent");
});

posix("uninstall preserves a command replaced by the user", async () => {
  await run(install(ctx, { source, version: "1.0.0", command: true }));
  rmSync(userCommandPath(home));
  writeFileSync(userCommandPath(home), "user-owned");
  await run(uninstall(ctx, { purge: false }));
  expect(readFileSync(userCommandPath(home), "utf8")).toBe("user-owned");
});

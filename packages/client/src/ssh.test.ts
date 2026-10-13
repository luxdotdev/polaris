import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ensureControlDir, resolveSshBinary, sshArgv } from "./ssh.ts";
import { Ssh } from "./install/Ssh.ts";

test("Windows omits all multiplexing options, including explicit overrides", () => {
  const argv = sshArgv("studio", {
    platform: "win32",
    sshBinary: "ssh.exe",
    controlDir: "/unused",
    controlPersist: "1h",
  });

  expect(argv[0]).toBe("ssh.exe");
  expect(argv.join(" ")).not.toMatch(/ControlMaster|ControlPath|ControlPersist/);
  expect(argv).toContain("StrictHostKeyChecking=yes");
  expect(argv).toContain("UpdateHostKeys=no");
  expect(argv.slice(-4)).toEqual(["--", "studio", "~/.polaris/bin/current/polaris", "bridge"]);
});

test("Windows never creates a control directory; POSIX still does", () => {
  const root = mkdtempSync(join(tmpdir(), "polaris-control-"));

  try {
    const dir = join(root, "ssh");
    ensureControlDir(dir, "win32");
    expect(existsSync(dir)).toBe(false);
    ensureControlDir(dir, "darwin");
    expect(existsSync(dir)).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Windows resolves native OpenSSH before PATH, with an explicit override first", () => {
  const native = "C:\\Windows\\System32\\OpenSSH\\ssh.exe";
  const env = { SystemRoot: "C:\\Windows" };
  const checked: Array<string> = [];
  expect(
    resolveSshBinary({ platform: "win32" }, env, (path) => {
      checked.push(path);

      return true;
    })
  ).toBe(native);
  expect(checked).toEqual([native]);
  expect(resolveSshBinary({ platform: "win32" }, env, () => false)).toBe("ssh");
  expect(resolveSshBinary({ platform: "win32" }, {}, () => true)).toBe("ssh");
  expect(resolveSshBinary({ platform: "win32" }, { SYSTEMROOT: "D:\\Windows" }, () => true)).toBe(
    "D:\\Windows\\System32\\OpenSSH\\ssh.exe"
  );

  for (const platform of ["win32", "darwin", "linux"] as const) {
    expect(
      resolveSshBinary({ platform, sshBinary: "/custom/ssh" }, env, () => {
        throw new Error("must not probe");
      })
    ).toBe("/custom/ssh");
  }

  expect(
    resolveSshBinary({ platform: "darwin" }, env, () => {
      throw new Error("must not probe");
    })
  ).toBe("ssh");
});

test("install uses the selected SSH binary and streams the local file unchanged", async () => {
  const root = mkdtempSync(join(tmpdir(), "polaris-ssh-binary-"));

  try {
    const binary = join(root, "custom ssh");
    const input = join(root, "input");
    writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\n', { mode: 0o700 });
    writeFileSync(input, "payload");

    const result = await Effect.runPromise(
      Ssh.use((ssh) => ssh.exec("studio", "echo remote", { stdinFile: input })).pipe(
        Effect.provide(Ssh.withOptions({ platform: "win32", sshBinary: binary }))
      )
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("BatchMode=yes\n");
    expect(result.stdout).toContain("StrictHostKeyChecking=yes\n");
    expect(result.stdout).toContain("UpdateHostKeys=no\n");
    expect(result.stdout).toEndWith("--\nstudio\necho remote\npayload");
    expect(result.stdout).not.toContain("Control");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

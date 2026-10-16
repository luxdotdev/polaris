import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginShellPathAsync, userPathAsync } from "./userPath.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-client-userpath-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in login shell: rc noise, then whatever `-c` prints with PATH set as given. */
const fakeShell = (path: string, extra = "") => {
  const shell = join(dir, "fakesh");

  writeFileSync(
    shell,
    `#!/bin/sh\necho "rc noise: no job control"\n${extra}\nshift 3\nPATH='${path}' /bin/sh -c "$1"\n`
  );
  chmodSync(shell, 0o755);

  return shell;
};

describe("userPathAsync", () => {
  test("a Dock-launched app's bare PATH gains the login shell's, ahead of /usr/bin", async () => {
    const home = join(dir, "home");

    mkdirSync(join(home, ".local", "bin"), { recursive: true });

    const shell = fakeShell("/opt/homebrew/bin:/usr/bin");

    const path = await userPathAsync({
      env: { SHELL: shell, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home },
    });

    expect(path.split(":").slice(0, 3)).toEqual(["/opt/homebrew/bin", "/usr/bin", "/bin"]);
    expect(path).toContain(join(home, ".local", "bin"));
  });

  test("a shell that hangs or is missing only costs the timeout, and the PATH is kept", async () => {
    const started = Date.now();

    expect(
      await loginShellPathAsync({ env: { SHELL: fakeShell("/x", "sleep 5") }, timeoutMs: 300 })
    ).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(
      await userPathAsync({ env: { SHELL: join(dir, "missing"), PATH: "/usr/bin", HOME: dir } })
    ).toStartWith("/usr/bin");
  });
});

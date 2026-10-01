import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginShellPath, mergePaths, parseMarkedPath, userPath, which } from "./userPath.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "polaris-userpath-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in login shell: rc noise, then whatever `-c` prints with PATH set as given. */
const fakeShell = (path: string, extra = "") => {
  const shell = join(dir, "fakesh");

  writeFileSync(
    shell,
    `#!/bin/sh\necho "rc noise: no job control"\n${extra}\nPATH='${path}'\nshift 3\n# $1 is -c's script\nPATH='${path}' /bin/sh -c "$1"\n`
  );
  chmodSync(shell, 0o755);

  return shell;
};

describe("parseMarkedPath", () => {
  test("takes the PATH between the markers, whatever the rc files print", () => {
    expect(parseMarkedPath("hello\n__POLARIS_PATH__/a:/b__POLARIS_END__\n")).toBe("/a:/b");
    expect(parseMarkedPath("no markers")).toBeNull();
    expect(parseMarkedPath("__POLARIS_PATH____POLARIS_END__")).toBeNull();
  });
});

describe("mergePaths", () => {
  test("keeps first-seen order, drops duplicates and empties", () => {
    expect(mergePaths("/a:/b", null, "/b::/c", undefined, "/a")).toBe("/a:/b:/c");
  });
});

describe("userPath", () => {
  test("puts the login shell's PATH first, then the service's, then well-known dirs", () => {
    const home = join(dir, "home");

    mkdirSync(join(home, ".local", "bin"), { recursive: true });
    const shell = fakeShell("/home/me/.nvm/bin:/usr/bin");
    const path = userPath({ env: { SHELL: shell, PATH: "/usr/bin:/bin", HOME: home } });

    expect(path.split(":").slice(0, 3)).toEqual(["/home/me/.nvm/bin", "/usr/bin", "/bin"]);
    expect(path).toContain(join(home, ".local", "bin"));
  });

  test("a shell that hangs or has no answer only costs the timeout", () => {
    const shell = fakeShell("/x", "sleep 5");
    const started = Date.now();

    expect(loginShellPath({ env: { SHELL: shell }, timeoutMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(loginShellPath({ env: { SHELL: join(dir, "missing") } })).toBeNull();
    expect(userPath({ env: { PATH: "/usr/bin", HOME: join(dir, "none") } })).toContain("/usr/bin");
  });

  test("POLARIS_USER_PATH=off keeps the given PATH", () => {
    expect(
      userPath({ env: { POLARIS_USER_PATH: "off", PATH: "/only", SHELL: fakeShell("/x") } })
    ).toBe("/only");
  });
});

describe("which", () => {
  test("finds a binary on the PATH set after start, which a bare Bun.which misses", () => {
    const dir = mkdtempSync(join(tmpdir(), "polaris-which-"));
    const bin = join(dir, "polaris-which-probe");
    writeFileSync(bin, "#!/bin/sh\n");
    chmodSync(bin, 0o755);
    const previous = process.env.PATH;

    try {
      process.env.PATH = `${dir}:${previous ?? ""}`;
      expect(which("polaris-which-probe")).toBe(bin);
    } finally {
      process.env.PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

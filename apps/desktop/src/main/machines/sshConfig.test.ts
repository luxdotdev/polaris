import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandGlob, parseLine, parseSshConfig, readSshAliases } from "./sshConfig.ts";

const files = (map: Record<string, string>) => ({
  home: "/h",
  read: (path: string) => map[path] ?? null,
  expand: (pattern: string) => Object.keys(map).filter((p) => p === pattern),
});

const aliases = (text: string, map: Record<string, string> = {}) =>
  parseSshConfig(text, files(map)).map((a) => a.alias);

describe("parseLine", () => {
  test("keyword forms", () => {
    expect(parseLine("Host studio")).toEqual({ keyword: "host", args: ["studio"] });
    expect(parseLine("  HostName=10.0.0.2")).toEqual({ keyword: "hostname", args: ["10.0.0.2"] });
    expect(parseLine("User = pi")).toEqual({ keyword: "user", args: ["pi"] });
    expect(parseLine('Host "my box" other')).toEqual({
      keyword: "host",
      args: ["my box", "other"],
    });
    expect(parseLine("# comment")).toBeNull();
    expect(parseLine("   ")).toBeNull();
  });
});

describe("parseSshConfig", () => {
  test("lists literal aliases and skips wildcards and negations", () => {
    const text = [
      "Host *",
      "  ServerAliveInterval 30",
      "Host studio pi !bastion *.internal dev-? -oProxyCommand=x",
      "  HostName 10.0.0.2",
      "  User lucas",
      "Host vm",
    ].join("\n");

    expect(aliases(text)).toEqual(["studio", "pi", "vm"]);
    expect(parseSshConfig(text, files({}))[0]).toEqual({
      alias: "studio",
      hostName: "10.0.0.2",
      user: "lucas",
    });
  });

  test("Match blocks name no alias and don't leak settings into the previous Host", () => {
    const text = [
      "Host studio",
      "  HostName studio.lan",
      "Match host studio exec true",
      "  User someone",
      "Host pi",
    ].join("\n");

    expect(parseSshConfig(text, files({}))).toEqual([
      { alias: "studio", hostName: "studio.lan", user: null },
      { alias: "pi", hostName: null, user: null },
    ]);
  });

  test("follows Include, relative to ~/.ssh and with ~, in order", () => {
    const text = ["Include config.d/work", "Host a", "Include ~/other"].join("\n");

    const map = {
      "/h/.ssh/config.d/work": "Host work-vm\n  HostName 10.0.4.12\nInclude /abs/nested",
      "/abs/nested": "Host nested",
      "/h/other": "Host b\nHost a",
    };

    expect(aliases(text, map)).toEqual(["work-vm", "nested", "a", "b"]);
  });

  test("a self-including config stops at ssh's depth limit", () => {
    const map = { "/h/.ssh/loop": "Host x\nInclude loop" };
    expect(aliases("Include loop", map)).toEqual(["x"]);
  });
});

describe("readSshAliases", () => {
  test("Windows discovers backslash globs and environment Includes in real files", () => {
    const home = mkdtempSync(join(tmpdir(), "polaris-win-ssh-"));

    try {
      mkdirSync(join(home, ".ssh", "config.d"), { recursive: true });
      writeFileSync(
        join(home, ".ssh", "config"),
        'Include "config.d\\*.conf"\nInclude "%USERPROFILE%\\extra"\n'
      );
      writeFileSync(join(home, ".ssh", "config.d", "b.conf"), "Host pi\n");
      writeFileSync(join(home, ".ssh", "config.d", "a.conf"), "Host vm\n");
      writeFileSync(join(home, "extra"), "Host extra\n");
      expect(
        readSshAliases(home, { platform: "win32", env: { USERPROFILE: home } }).map((a) => a.alias)
      ).toEqual(["vm", "pi", "extra"]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  test("reads the real files, expanding Include globs", () => {
    const home = mkdtempSync(join(tmpdir(), "polaris-ssh-"));

    try {
      mkdirSync(join(home, ".ssh", "config.d"), { recursive: true });
      writeFileSync(join(home, ".ssh", "config"), "Include config.d/*\nHost studio\n");
      writeFileSync(join(home, ".ssh", "config.d", "b.conf"), "Host pi\n");
      writeFileSync(join(home, ".ssh", "config.d", "a.conf"), "Host vm\n");
      expect(readSshAliases(home).map((a) => a.alias)).toEqual(["vm", "pi", "studio"]);
      expect(readSshAliases(join(home, "missing"))).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("Windows Include paths preserve drive roots, UNC roots, home and spaces", () => {
  const patterns: Array<string> = [];
  parseSshConfig(
    'Include "config.d\\*.conf" "~\\extra" "%USERPROFILE%\\with space\\*.conf" "D:\\ssh\\?.conf" "\\\\server\\share\\*.conf" "${USERPROFILE}\\other" "%UNSET%\\missing"',
    {
      home: "C:\\Users\\Lucas",
      platform: "win32",
      env: { UserProfile: "C:\\Users\\Lucas" },
      read: () => null,
      expand: (pattern) => {
        patterns.push(pattern);

        return [];
      },
    }
  );
  expect(patterns).toEqual([
    "C:/Users/Lucas/.ssh/config.d/*.conf",
    "C:/Users/Lucas/extra",
    "C:/Users/Lucas/with space/*.conf",
    "D:/ssh/?.conf",
    "//server/share/*.conf",
    "C:/Users/Lucas/other",
  ]);
});

test("Windows glob expansion traverses drive and UNC roots in sorted order", () => {
  for (const root of ["C:/Users/Lucas", "//server/share"]) {
    const paths = expandGlob(`${root.replaceAll("/", "\\")}\\*\\?.conf`, "win32", {
      list: (dir) =>
        dir.replace(/\/$/, "") === root ? ["b", ".hidden", "a"] : ["b.conf", "a.conf", "long.conf"],
      isFile: (path) => path.endsWith(".conf"),
    });

    expect(paths).toEqual([
      `${root}/a/a.conf`,
      `${root}/a/b.conf`,
      `${root}/b/a.conf`,
      `${root}/b/b.conf`,
    ]);
  }
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandPathHint,
  commandTarget,
  inspectCommand,
  installCommandLink,
  uninstallCommandLink,
  userCommandPath,
} from "./command.ts";

import { posixDescribe } from "../platform/testing.ts";

let home: string;

let target: string;

let path: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polaris-command-"));
  target = commandTarget(join(home, ".polaris"));
  path = userCommandPath(home);
  mkdirSync(join(home, ".polaris/bin/current"), { recursive: true });
  writeFileSync(target, "#!/bin/sh\necho installed\n");
  chmodSync(target, 0o755);
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

posixDescribe("POSIX command links")("command links", () => {
  test("install creates the directory and is idempotent; uninstall removes only the link", () => {
    installCommandLink(path, target);
    const inode = lstatSync(path).ino;
    installCommandLink(path, target);
    expect(lstatSync(path).ino).toBe(inode);
    expect(readlinkSync(path)).toBe(target);
    expect(inspectCommand(path, target, `${home}/.local/bin:/usr/bin`).onPath).toBe(true);
    uninstallCommandLink(path, target);
    uninstallCommandLink(path, target);
    expect(inspectCommand(path, target, "").state).toBe("absent");
    expect(readFileSync(target, "utf8")).toContain("installed");
  });

  test.each(["file", "link"])("preserves an existing %s on install and uninstall", (kind) => {
    mkdirSync(join(home, ".local/bin"), { recursive: true });

    if (kind === "file") writeFileSync(path, "another command");
    else symlinkSync(join(home, "missing-other-command"), path);
    expect(() => installCommandLink(path, target)).toThrow("another command");
    uninstallCommandLink(path, target);
    expect(inspectCommand(path, target, "").state).toBe("conflict");
  });

  test("uninstall recognizes its dangling link and keeps other homes", () => {
    installCommandLink(path, target);
    rmSync(target);
    uninstallCommandLink(path, commandTarget(join(home, "other-home")));
    expect(inspectCommand(path, target, "").state).toBe("installed");
    uninstallCommandLink(path, target);
    expect(inspectCommand(path, target, "").state).toBe("absent");
  });

  test("a missing executable leaves no dangling command; PATH checks whole entries", () => {
    rmSync(target);
    expect(() => installCommandLink(path, target)).toThrow();
    expect(inspectCommand(path, target, "").state).toBe("absent");
    expect(commandPathHint(inspectCommand(path, target, `${home}/.local/bin-extra`))).toContain(
      "open a new shell"
    );
    expect(commandPathHint(inspectCommand(path, target, `${home}/.local/bin`))).toBeNull();
  });
});

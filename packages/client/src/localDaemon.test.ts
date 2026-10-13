import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installedPaths, localDaemonFailure, logTail } from "./localDaemon.ts";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "polaris-local-"));
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

const install = () => {
  const { binary } = installedPaths(home);
  mkdirSync(join(binary, ".."), { recursive: true });
  writeFileSync(binary, "#!/bin/sh\n");
};

const writeLog = (name: "errorLog" | "outputLog", text: string) => {
  const path = installedPaths(home)[name];
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

describe("localDaemonFailure", () => {
  test("without an installed home it is just the socket", () => {
    expect(localDaemonFailure("/s.sock")).toMatchObject({
      reason: "daemon-not-running",
      detail: "no Daemon is listening on /s.sock",
    });
  });

  test("nothing installed in the home is polaris-not-installed", () => {
    expect(localDaemonFailure("/s.sock", home)).toMatchObject({
      kind: "needs-attention",
      reason: "polaris-not-installed",
      detail: `nothing is installed at ${installedPaths(home).binary}`,
    });
  });

  test("an installed Daemon that isn't listening shows its error log's last lines", () => {
    install();
    writeLog("errorLog", "one\ntwo\n\nthree\nfour: dyld: killed\n\n");
    const failure = localDaemonFailure("/s.sock", home);

    expect(failure.reason).toBe("daemon-not-running");
    expect(failure.detail.split("\n")).toEqual([
      "no Daemon is listening on /s.sock",
      `${installedPaths(home).errorLog}:`,
      "two",
      "three",
      "four: dyld: killed",
    ]);
  });

  test("falls back to the output log, then says the log is empty", () => {
    install();
    expect(localDaemonFailure("/s.sock", home).detail).toContain(
      `nothing in ${installedPaths(home).errorLog}`
    );
    writeLog("outputLog", "listening on /s.sock\n");
    expect(localDaemonFailure("/s.sock", home).detail).toContain("listening on /s.sock");
  });

  test("logTail reads only the end of a long log", () => {
    writeLog("errorLog", `${"x".repeat(10_000)}\nlast\n`);
    expect(logTail(installedPaths(home).errorLog, 1)).toEqual(["last"]);
    expect(logTail(join(home, "missing.log"))).toEqual([]);
  });
});

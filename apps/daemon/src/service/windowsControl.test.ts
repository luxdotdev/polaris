import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const windows = process.platform === "win32";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

// The control pipe is a Windows named pipe with this user's DACL (ADR 0059, 0060).
describe.skipIf(!windows)("the control pipe (Windows only)", () => {
  const serve = async () => {
    const { askDaemon, serveControl } = await import("./windowsControl.ts");
    const home = mkdtempSync(join(tmpdir(), "polaris-control-"));
    const stops: Array<string> = [];
    const server = serveControl(home, "9.9.9-test", (reason) => stops.push(reason));
    cleanups.push(() => {
      server.stop();
      rmSync(home, { recursive: true, force: true });
    });

    return { askDaemon, home, stops };
  };

  test("status names this Daemon's PID and version and stops nothing", async () => {
    const { askDaemon, home, stops } = await serve();

    expect(await askDaemon(home, { op: "status" })).toEqual({
      kind: "reply",
      reply: { pid: process.pid, version: "9.9.9-test" },
    });
    expect(stops).toEqual([]);
  });

  test("a stop is answered before the Daemon acts on it, with its reason", async () => {
    const { askDaemon, home, stops } = await serve();

    expect(await askDaemon(home, { op: "stop", reason: "upgrade" })).toMatchObject({
      kind: "reply",
    });
    expect(stops).toEqual(["upgrade"]);
  });

  test("with no Daemon, nothing answers", async () => {
    const { askDaemon } = await import("./windowsControl.ts");
    const home = mkdtempSync(join(tmpdir(), "polaris-control-"));
    cleanups.push(() => rmSync(home, { recursive: true, force: true }));

    expect(await askDaemon(home, { op: "status" }, 500)).toEqual({ kind: "none" });
  });
});

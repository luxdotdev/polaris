import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import {
  discoverDistros,
  discoveryOf,
  parseDistroList,
  WslDiscovery,
  WslDistro,
} from "./distros.ts";
import { writeFakeWsl } from "./fakeWsl.testing.ts";

const LIST = [
  "  NAME                   STATE           VERSION",
  "* Ubuntu                 Running         2",
  "  Debian                 Stopped         2",
  "  Legacy                 Stopped         1",
  "  docker-desktop         Running         2",
  "",
].join("\r\n");

describe("parseDistroList", () => {
  test("reads names, states, versions and the default", () => {
    expect(parseDistroList(LIST)).toEqual([
      new WslDistro({ name: "Ubuntu", version: 2, state: "running", isDefault: true }),
      new WslDistro({ name: "Debian", version: 2, state: "stopped", isDefault: false }),
      new WslDistro({ name: "Legacy", version: 1, state: "stopped", isDefault: false }),
      new WslDistro({ name: "docker-desktop", version: 2, state: "running", isDefault: false }),
    ]);
  });

  test("a localized header and state still yield the name and version", () => {
    const text =
      "  NAME       ZUSTAND         VERSION\r\n* Ubuntu     Wird ausgeführt  2\r\n  Alt   Angehalten   1\r\n";

    expect(parseDistroList(text)).toEqual([
      new WslDistro({ name: "Ubuntu", version: 2, state: "running", isDefault: true }),
      new WslDistro({ name: "Alt", version: 1, state: "unknown", isDefault: false }),
    ]);
  });

  test("a BOM, LF endings and a name with a space are fine", () => {
    expect(parseDistroList("﻿  NAME  STATE  VERSION\n  My Distro  Stopped  2\n")).toEqual([
      new WslDistro({ name: "My Distro", version: 2, state: "stopped", isDefault: false }),
    ]);
  });

  test("lines that aren't rows are skipped", () => {
    expect(parseDistroList("  NAME  STATE  VERSION\n  garbage\n")).toEqual([]);
  });
});

describe("discoveryOf", () => {
  const utf16 = (text: string) => new Uint8Array(Buffer.from(text, "utf16le"));
  const none = new Uint8Array(0);

  test("a missing wsl.exe is NotInstalled", () => {
    const error: NodeJS.ErrnoException = Object.assign(new Error("spawn"), { code: "ENOENT" });
    expect(discoveryOf({ code: null, stdout: none, stderr: none, spawnError: error })).toEqual(
      WslDiscovery.NotInstalled({ detail: "wsl.exe: ENOENT" })
    );
  });

  test("the stub's message is NotInstalled, no distros is NoDistros", () => {
    const stub = utf16(
      "Windows Subsystem for Linux is not installed. You can install by running 'wsl.exe --install'.\r\n"
    );

    expect(discoveryOf({ code: 1, stdout: none, stderr: stub, spawnError: null })._tag).toBe(
      "NotInstalled"
    );
    const empty = utf16("Windows Subsystem for Linux has no installed distributions.\r\n");
    expect(discoveryOf({ code: 1, stdout: empty, stderr: none, spawnError: null })._tag).toBe(
      "NoDistros"
    );
  });

  test("Docker Desktop's helper distros are hidden; only those alone count as none", () => {
    const only = utf16("  NAME  STATE  VERSION\r\n  docker-desktop  Running  2\r\n");
    expect(discoveryOf({ code: 0, stdout: only, stderr: none, spawnError: null })._tag).toBe(
      "NoDistros"
    );
    const found = discoveryOf({ code: 0, stdout: utf16(LIST), stderr: none, spawnError: null });
    expect(found).toEqual(
      WslDiscovery.Distros({
        distros: parseDistroList(LIST).filter((d) => d.name !== "docker-desktop"),
      })
    );
  });

  test("any other failure is Failed with the message", () => {
    const result = discoveryOf({ code: 2, stdout: none, stderr: utf16("boom"), spawnError: null });
    expect(result).toEqual(WslDiscovery.Failed({ detail: "boom" }));
  });
});

describe("discoverDistros", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "polaris-wsl-"));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const distros = [
    { name: "Ubuntu", version: 2 as const, state: "Running" as const, isDefault: true, home: "" },
    { name: "Old", version: 1 as const, state: "Stopped" as const, home: "" },
  ].map((d) => ({ ...d, home: join(dir ?? tmpdir(), d.name) }));

  test("off Windows the answer is Unsupported without spawning", async () => {
    expect(
      await Effect.runPromise(discoverDistros({ platform: "darwin", wslBinary: "/nope" }))
    ).toEqual(WslDiscovery.Unsupported());
  });

  test.each([true, false])(
    "lists the fake's distros (WSL_UTF8 honoured: %p)",
    async (honoursUtf8) => {
      const fake = writeFakeWsl(dir, {
        distros: distros.map((d) => ({ ...d, home: join(dir, d.name) })),
        honoursUtf8,
      });

      const found = await Effect.runPromise(discoverDistros({ ...fake, platform: "win32" }));
      expect(found).toEqual(
        WslDiscovery.Distros({
          distros: [
            new WslDistro({ name: "Ubuntu", version: 2, state: "running", isDefault: true }),
            new WslDistro({ name: "Old", version: 1, state: "stopped", isDefault: false }),
          ],
        })
      );
    }
  );

  test("a stub wsl.exe and a missing binary are NotInstalled", async () => {
    const fake = writeFakeWsl(dir, { distros: [], installed: false });
    expect((await Effect.runPromise(discoverDistros({ ...fake, platform: "win32" })))._tag).toBe(
      "NotInstalled"
    );

    const missing = await Effect.runPromise(
      discoverDistros({ wslBinary: join(dir, "absent.exe"), env: fake.env, platform: "win32" })
    );

    expect(missing._tag).toBe("NotInstalled");
  });
});

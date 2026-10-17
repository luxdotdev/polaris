import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { system32 } from "../../platform/processes.ts";
import { parseSid, tokenFileOf, writeToken } from "./windowsToken.ts";

/** A high-integrity (elevated) token: `whoami /groups` lists S-1-16-12288. */
const elevated = () =>
  process.platform === "win32" &&
  Bun.spawnSync([system32("whoami.exe"), "/groups"])
    .stdout.toString()
    .includes("S-1-16-12288");

/** The unelevated Daemon's case; an elevated session (CI's runner) keeps more entries (ENG-314). */
const unelevatedWindows = test.skipIf(process.platform !== "win32" || elevated());

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The access entries `icacls` prints for `path`, without the path itself. */
const aclOf = (path: string) =>
  Bun.spawnSync([system32("icacls.exe"), path])
    .stdout.toString()
    .split(/\r?\n/)
    .map((line) => line.replace(path, "").trim())
    .filter((line) => line.includes(":("));

describe("the Codex token", () => {
  test("is granted to the SID whoami reports, not a name a domain can make ambiguous", () => {
    expect(parseSid('"lucas-desktop\\lucas","S-1-5-21-1-2-3-1001"\r\n')).toBe(
      "S-1-5-21-1-2-3-1001"
    );
    expect(parseSid("ERROR: access denied")).toBeNull();
  });

  unelevatedWindows("sits in a directory only this user may open, and is only theirs", () => {
    const home = mkdtempSync(join(tmpdir(), "pas-token-"));
    dirs.push(home);
    const file = tokenFileOf(join(home, "codex-app-server.json"));
    const me = `${userInfo().username}:`;

    writeToken(file);
    writeToken(file);

    expect(readFileSync(file, "utf8")).toMatch(/^[0-9a-f]{64}$/);
    // A replaced token leaves no temporary file behind.
    expect(readdirSync(dirname(file))).toEqual(["token"]);
    // One entry each: this user, nothing inherited into the directory, the file's from it.
    const [dirAcl, fileAcl] = [aclOf(dirname(file)), aclOf(file)];

    expect([dirAcl.length, fileAcl.length]).toEqual([1, 1]);
    expect(dirAcl[0]).toEndWith(`${me}(OI)(CI)(F)`);
    expect(fileAcl[0]).toEndWith(`${me}(I)(F)`);
  });
});

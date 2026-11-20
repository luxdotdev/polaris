import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withBuildLock } from "./buildLock.ts";

const dir = mkdtempSync(join(tmpdir(), "relay-lock-"));

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const HOLDERS = 4;

/** Each holder appends "+" on entry and "-" on exit, holding the lock a while in between. */
const holder = (lock: string, log: string) => `
  import { appendFileSync } from "node:fs";
  import { withBuildLock } from ${JSON.stringify(join(import.meta.dir, "buildLock.ts"))};
  withBuildLock(${JSON.stringify(lock)}, () => {
    appendFileSync(${JSON.stringify(log)}, "+");
    Bun.sleepSync(80);
    appendFileSync(${JSON.stringify(log)}, "-");
  });
`;

test("processes that build at once take turns", async () => {
  const lock = join(dir, "turns", "build.lock");
  const log = join(dir, "turns.log");

  writeFileSync(log, "");

  const children = Array.from({ length: HOLDERS }, () =>
    Bun.spawn([process.execPath, "-e", holder(lock, log)], { stderr: "pipe" })
  );

  const codes = await Promise.all(children.map((child) => child.exited));

  expect(codes).toEqual(Array.from({ length: HOLDERS }, () => 0));
  expect(readFileSync(log, "utf8")).toBe("+-".repeat(HOLDERS));
});

test("a lock left by a process that died is taken over", async () => {
  const lock = join(dir, "stale.lock");
  const dead = Bun.spawn([process.execPath, "-e", ""]);
  await dead.exited;

  writeFileSync(lock, String(dead.pid));

  expect(withBuildLock(lock, () => "built")).toBe("built");
});

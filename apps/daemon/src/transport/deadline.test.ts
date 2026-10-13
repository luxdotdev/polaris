import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { deadline, SERVE_EXIT_STUCK } from "./deadline.ts";

const fixture = join(import.meta.dir, "fixtures/stuck-serve.ts");

test("a deadline reports the phase it expired in, and a cleared one never fires", async () => {
  const expired: Array<string> = [];

  const missed = deadline("starting", { ms: 20, onExpire: (phase) => expired.push(phase) });
  missed.phase("building handlers");
  const met = deadline("starting", { ms: 20, onExpire: (phase) => expired.push(`met ${phase}`) });
  met.clear();

  await Bun.sleep(60);

  expect(expired).toEqual(["building handlers"]);
});

const run = async (mode: string, stop: boolean) => {
  const child = spawn(process.execPath, [fixture, mode], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  if (stop) {
    await once(child.stdout, "data");
    child.kill("SIGTERM");
  }

  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);

  const code = await new Promise<number | null>((resolve) => {
    child.on("exit", (status) => resolve(status));
  });

  clearTimeout(timeout);

  return { code, stderr };
};

test("a startup parked in an uninterruptible region exits non-zero and says where", async () => {
  const { code, stderr } = await run("startup", false);

  expect(code).toBe(SERVE_EXIT_STUCK);
  expect(stderr).toContain("startup did not finish");
  expect(stderr).toContain("recovering Constellations");
});

test("SIGTERM ends the process even when the graceful stop never finishes", async () => {
  const { code, stderr } = await run("shutdown", true);

  expect(code).toBe(SERVE_EXIT_STUCK);
  expect(stderr).toContain("shutdown did not finish");
});

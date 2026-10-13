import { expect, test } from "bun:test";
import { join } from "node:path";

test("startup and unrelated language RPCs do not import the context assembler or grammars", async () => {
  const child = Bun.spawn([process.execPath, "test", join(import.meta.dir, "rpc.socket.test.ts")], {
    env: { ...process.env, POLARIS_TCTX_LAZY_PROBE: "1" },
    stdout: "ignore",
    stderr: "pipe",
  });

  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr: code === 0 ? "" : stderr }).toEqual({ code: 0, stderr: "" });
}, 20000);

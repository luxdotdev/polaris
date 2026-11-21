import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepestWorkspace } from "./startRpc.ts";

test("user CLI cwd selects the deepest containing Workspace with path-segment boundaries", () => {
  const root = join(process.cwd(), "fixture");
  const outer = { path: root, id: "outer" };
  const inner = { path: join(root, "app"), id: "inner" };
  expect(deepestWorkspace([inner, outer], join(root, "app", "src"))?.id).toBe("inner");
  expect(deepestWorkspace([inner, outer], join(root, "application"))?.id).toBe("outer");
  expect(deepestWorkspace([inner, outer], join(root, "..", "elsewhere"))).toBeUndefined();
});

test("user CLI cwd matches a Workspace registered through a symlinked path", () => {
  const real = mkdtempSync(join(tmpdir(), "start-rpc-real-"));
  const link = join(mkdtempSync(join(tmpdir(), "start-rpc-link-")), "repo");
  symlinkSync(real, link);
  mkdirSync(join(real, "src"));
  const workspace = { path: link, id: "linked" };
  expect(deepestWorkspace([workspace], join(realpathSync(real), "src"))?.id).toBe("linked");
});

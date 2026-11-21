import { expect, test } from "bun:test";
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

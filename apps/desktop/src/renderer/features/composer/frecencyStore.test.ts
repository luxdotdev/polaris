import { expect, test } from "bun:test";
import { boundScopes, MAX_SCOPES, scopeKey } from "./frecencyStore.ts";

test("a table per Host, Workspace and Harness; the least recently used go past the bound", () => {
  expect(scopeKey({ hostKey: "local", workspaceId: "w1", harness: "claude" })).not.toBe(
    scopeKey({ hostKey: "local", workspaceId: "w1", harness: "codex" })
  );

  const stored = Object.fromEntries(
    Array.from({ length: MAX_SCOPES + 3 }, (_, i) => [`s${i}`, { usedAt: i, table: {} }])
  );

  const kept = boundScopes(stored);

  expect(Object.keys(kept)).toHaveLength(MAX_SCOPES);
  expect(kept).not.toHaveProperty("s0");
  expect(kept).toHaveProperty(`s${MAX_SCOPES + 2}`);
});

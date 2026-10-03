import { expect, test } from "bun:test";
import { actionItems } from "./items.ts";
import { rank } from "./ranking.ts";

test("the ready Update is the last action and is found by update, restart or upgrade", () => {
  const items = actionItems({
    workspace: null,
    session: null,
    enabled: () => true,
    nextTheme: "dark",
    updateVersion: "0.5.0",
  });

  const ready = items.at(-1);

  expect(ready).toMatchObject({
    title: "Restart to update",
    detail: "Polaris 0.5.0 · agent sessions keep working",
  });

  for (const query of ["update", "restart", "upgrade"]) {
    expect(
      rank({ items, query, recency: () => Infinity, limit: 5, urgent: () => false }).some(
        (item) => item.id === ready?.id
      )
    ).toBe(true);
  }

  expect(items.some((item) => item.title === "Settings: About")).toBe(true);
  expect(items.some((item) => item.title === "Check for updates")).toBe(true);
});

test("restart disappears until main has a ready Update", () => {
  const items = actionItems({
    workspace: null,
    session: null,
    enabled: (id) => id !== "updates.restart",
    nextTheme: "dark",
  });

  expect(items.some((item) => item.title === "Restart to update")).toBe(false);
});

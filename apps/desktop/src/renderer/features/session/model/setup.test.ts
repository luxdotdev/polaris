import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeSetupRun, TaskId, ConstellationId } from "@polaris/protocol";
import { conversationRows } from "./conversation.ts";
import { SetupCard } from "../ui/SetupCard.tsx";

const setup = (status: WorktreeSetupRun["status"]) =>
  WorktreeSetupRun.make({
    id: "setup",
    constellationId: ConstellationId.make("c"),
    taskId: TaskId.make("A"),
    command: "bun install",
    cwd: "/repo/A",
    status,
    output: "packages installed\n",
    exitCode: status === "running" ? null : 0,
    startedAt: "2026-10-02T00:00:00.000Z",
    endedAt: status === "running" ? null : "2026-10-02T00:00:01.000Z",
  });

test("Turn-less worker setup occupies its own row, before prompts and Claim trailers", () => {
  const card = setup("running");
  expect(conversationRows({ turns: [], approvals: [], unfolded: new Set(), setup: card })).toEqual([
    { kind: "setup", key: card.id, setup: card },
  ]);
  expect(conversationRows({ turns: [], approvals: [], unfolded: new Set() })).toEqual([]);
});

test("setup cards state the command, output and failure action without Harness chrome", () => {
  for (const status of ["running", "completed", "failed"] as const) {
    const html = renderToStaticMarkup(createElement(SetupCard, { setup: setup(status) }));
    expect(html).toContain("Worktree setup");
    expect(html).toContain("bun install");
    expect(html).toContain("packages installed");
    expect(html).toContain(`data-status="${status}"`);

    if (status === "failed") {
      expect(html).toContain("Fix setup");
      expect(html).toContain("open=");
    }
  }
});

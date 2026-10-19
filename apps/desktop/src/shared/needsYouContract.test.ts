import { expect, test } from "bun:test";
import { Schema } from "effect";
import { RequestInputs } from "./contract.ts";
import type { NeedsYouSummary } from "./needsYou.ts";

test("a Needs You summary crosses IPC whole: turns' replies, digest marks, user Turns, background tasks and Reviews, and agent notifications", () => {
  const pull = {
    kind: "pull" as const,
    repo: { owner: "acme", name: "api" },
    number: 12,
    pullId: null,
  };

  const summary: NeedsYouSummary = {
    count: 0,
    sessions: [],
    focused: null,
    turns: [
      {
        hostKey: "local",
        hostLabel: "This Mac",
        sessionId: "s1",
        title: "Lead",
        harness: "Claude",
        state: "idle",
        reply: "Fixed the login form.",
        digestStarted: true,
        backgroundTasks: 1,
        userTurn: { id: "t1", startedAt: "2026-10-19T09:00:00Z" },
        updatedAt: "2026-10-19T09:07:00Z",
      },
      {
        hostKey: "local",
        hostLabel: "This Mac",
        sessionId: "s2",
        title: "Reviewer · Pull request #12",
        harness: "Claude",
        state: "idle",
        reply: null,
        backgroundTasks: 0,
        userTurn: null,
        updatedAt: "2026-10-19T09:07:00Z",
        review: {
          kind: "reviewer",
          change: "Retry flaky uploads",
          target: pull,
          findings: { open: 2, critical: 1 },
        },
      },
    ],
    reviewing: { kind: "session", hostKey: "local", sessionId: "s1" },
    notifications: [
      {
        hostKey: "local",
        hostLabel: "This Mac",
        sessionId: "s1",
        sessionTitle: "Lead",
        id: "mcp:n1",
        title: "Tests pass",
        body: "",
      },
    ],
  };

  expect(Schema.decodeUnknownSync(RequestInputs["needsYou.publish"])(summary)).toEqual(summary);
});

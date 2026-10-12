import { expect, test } from "bun:test";
import { Schema } from "effect";
import { RequestInputs } from "./contract.ts";
import type { NeedsYouSummary } from "./needsYou.ts";

test("a Needs You summary crosses IPC whole: turns' digest marks and agent notifications", () => {
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
        prompt: null,
        digestStarted: true,
      },
    ],
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

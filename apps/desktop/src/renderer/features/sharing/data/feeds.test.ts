import { expect, test } from "bun:test";
import type { SharedWithMeView } from "../../../../shared/sharingContract.ts";
import { actorViewerOf } from "./feeds.ts";

const view: SharedWithMeView = {
  invites: [],
  accounts: [{ id: "a1", login: "hubot" }],
  sessions: [
    {
      accountId: "a1",
      hostKey: "shared-abc",
      sessionId: "s1",
      title: "Fix the login redirect",
      owner: { login: "octocat", name: "The Octocat", avatar: null },
      hostName: "Mac Studio",
      role: "contributor",
      selfPersonId: "p-hubot",
      hostOffline: false,
      ended: false,
    },
  ],
};

test("names in a session shared with you read from its owner and your person; your own don't", () => {
  expect(actorViewerOf(view, "shared-abc", "s1")).toEqual({
    owner: "The Octocat",
    selfPersonId: "p-hubot",
  });
  // Your own Host, another session there, and before the feed's first item.
  expect([
    actorViewerOf(view, "local", "s1"),
    actorViewerOf(view, "shared-abc", "s2"),
    actorViewerOf(null, "shared-abc", "s1"),
  ]).toEqual(Array.from({ length: 3 }, () => ({ owner: null, selfPersonId: null })));
});

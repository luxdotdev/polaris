import { expect, test } from "bun:test";
import type { SharedWithMeView } from "../../../../shared/sharingContract.ts";
import { actorViewerOf, isSharedHost, shareEndedNotice } from "./feeds.ts";

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

// A revoked Teammate kept a live composer, and got the owner's Share button after a relaunch.
test("a Share that ended says so in place of the composer, and its Host still reads as theirs", () => {
  const ended: SharedWithMeView = {
    ...view,
    sessions: view.sessions.map((s) => ({ ...s, ended: true })),
  };

  expect(shareEndedNotice(ended, "shared-abc", "s1")).toBe(
    "This share ended. Ask The Octocat to share it again."
  );
  expect([
    shareEndedNotice(view, "shared-abc", "s1"),
    shareEndedNotice(ended, "local", "s1"),
  ]).toEqual([null, null]);
  // After a relaunch the ended Share's Host isn't dialled; your own Host never counts.
  expect([isSharedHost([], ended, "shared-abc"), isSharedHost([], ended, "local")]).toEqual([
    true,
    false,
  ]);
});

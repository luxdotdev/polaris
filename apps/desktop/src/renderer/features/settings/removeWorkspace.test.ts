import { afterEach, beforeEach, expect, test } from "bun:test";
import { ResolvedReviewer, ReviewerChoice, ReviewerSettings, WorkspaceId } from "@polaris/protocol";
import { Commands } from "../../commands.ts";
import { installFakeBridge, type FakeBridge } from "../../test/bridge.testing.ts";
import { standInBridge } from "../bridge.ts";
import { removeWorkspace } from "./removeWorkspace.ts";
import { DEFAULT_SESSION_PREFS } from "../../../shared/sessionPrefs.ts";
import { settingsStore } from "./store.ts";

let fake: FakeBridge;

const choice = ReviewerChoice.make({ harness: "codex", model: null, effort: null });

beforeEach(() => {
  fake = installFakeBridge();
  fake.answerOk("review.reviewerSettings", {
    settings: ReviewerSettings.make({
      default: null,
      workspaces: { warehouse: choice, polaris: choice },
    }),
    resolved: ResolvedReviewer.make({ choice: null, source: "auto", note: null }),
  });
  settingsStore.setState({
    sessions: {
      ...DEFAULT_SESSION_PREFS,
      workspaceAcceptBranch: { "mac/warehouse": "current", "mac/polaris": "create" },
    },
  });
});

afterEach(() => standInBridge(null));

test("a removal drops the workspace's overrides here and on its host, and only its own", async () => {
  expect(await removeWorkspace("mac", "warehouse")).toBe(true);

  expect(fake.sent("dispatch").map((d) => [d.hostKey, d.command])).toEqual([
    ["mac", Commands.RemoveWorkspace({ workspaceId: WorkspaceId.make("warehouse") })],
  ]);
  expect(
    fake.sent("review.setReviewerSettings").map((s) => Object.keys(s.settings.workspaces))
  ).toEqual([["polaris"]]);
  expect(fake.sent("github.routing.setWorkspace")).toEqual([
    { workspace: { hostKey: "mac", workspaceId: "warehouse" }, accountId: null },
  ]);
  expect(settingsStore.getState().sessions.workspaceAcceptBranch).toEqual({
    "mac/polaris": "create",
  });
});

test("a refused removal keeps every override", async () => {
  fake.refuse("dispatch", {
    code: "CommandRejected",
    message: "CommandRejected: archive the Workspace's Agent Sessions before removing it",
  });

  expect(await removeWorkspace("mac", "warehouse")).toBe(false);

  expect(fake.sent("review.setReviewerSettings")).toEqual([]);
  expect(fake.sent("github.routing.setWorkspace")).toEqual([]);
  expect(Object.keys(settingsStore.getState().sessions.workspaceAcceptBranch)).toHaveLength(2);
});

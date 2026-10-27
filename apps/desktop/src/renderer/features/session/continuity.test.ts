import "../../test/dom.testing.ts";
import { ComposerDraft, ContinuityItem, SessionId, TurnId } from "@polaris/protocol";
import { DRAFT_SAVE_DELAY_MS } from "@polaris/client/continuity";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { type FakeBridge, installFakeBridge } from "../../test/bridge.testing.ts";
import { standInBridge } from "../bridge.ts";
import { useSessionContinuity } from "./continuity.ts";
import { patchSessionUi, uiKey, useSessionUi } from "./state.ts";

const at = "2026-10-27T00:00:00.000Z";

let bridge: FakeBridge;

let count = 0;

beforeEach(() => {
  bridge = installFakeBridge();
});

afterEach(() => {
  cleanup();
  standInBridge(null);
});

/** The open session on a fresh Host each test, so no feed carries over. */
const openSession = (lastEnded: TurnId | null) => {
  count += 1;
  const hostKey = `h-${count}`;
  const sessionId = SessionId.make(`s-${count}`);
  const key = uiKey(hostKey, sessionId);

  const view = renderHook(
    ({ ended }) => {
      useSessionContinuity({ hostKey, sessionId, enabled: true, lastEnded: ended });

      return useSessionUi(key);
    },
    { initialProps: { ended: lastEnded } }
  );

  return { hostKey, sessionId, key, view };
};

test("the Host's draft fills the composer, and typing here is saved after a pause", async () => {
  const { hostKey, sessionId, key, view } = openSession(null);
  const feed = bridge.feeds("continuity").at(-1)!;
  expect(feed.input).toEqual({ hostKey });

  act(() =>
    feed.listener.items([
      ContinuityItem.cases.Snapshot.make({
        reads: [],
        drafts: [new ComposerDraft({ sessionId, text: "From the phone", revision: 1, at })],
      }),
    ])
  );
  expect(view.result.current.draft).toBe("From the phone");
  // Restoring isn't a change to write back.
  expect(bridge.sent("continuity.saveDraft")).toEqual([]);

  bridge.answer("continuity.saveDraft", ({ text }) => ({
    ok: true,
    value: { sessionId, text, revision: 2, at },
  }));
  act(() => patchSessionUi(key, () => ({ draft: "From the phone, and the Mac" })));
  expect(bridge.sent("continuity.saveDraft")).toEqual([]);
  await waitFor(
    () =>
      expect(bridge.sent("continuity.saveDraft")).toEqual([
        { hostKey, sessionId, text: "From the phone, and the Mac" },
      ]),
    { timeout: DRAFT_SAVE_DELAY_MS * 4 }
  );
});

test("the newest ended Turn on screen is reported read, once each", () => {
  const first = TurnId.make("t-1");
  const { hostKey, sessionId, view } = openSession(first);
  view.rerender({ ended: first });
  view.rerender({ ended: TurnId.make("t-2") });

  expect(bridge.sent("continuity.markRead")).toEqual([
    { hostKey, sessionId, turnId: first },
    { hostKey, sessionId, turnId: TurnId.make("t-2") },
  ]);
});

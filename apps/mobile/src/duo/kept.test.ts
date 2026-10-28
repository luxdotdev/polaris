import { describe, expect, test } from "bun:test";
import type { Route } from "../app/route.ts";
import { chosen, claimKey, typed, type Unsent, unsentFor } from "../constellation/unsent.ts";
import { arrangementOf } from "./arrangement.ts";
import { constellationKey, keptStore, taskKey } from "./kept.ts";
import { FOLDED, type Posture } from "./posture.ts";

const unfolded: Posture = {
  kind: "unfolded",
  first: { x: 0, y: 0, width: 455.5, height: 669 },
  second: { x: 495.5, y: 0, width: 455.5, height: 669 },
  division: { x: 455.5, y: 0, width: 40, height: 669 },
};

const halfFolded: Posture = {
  kind: "halfFolded",
  top: { x: 0, y: 0, width: 669, height: 455.5 },
  bottom: { x: 0, y: 495.5, width: 669, height: 455.5 },
  division: { x: 0, y: 455.5, width: 669, height: 40 },
};

const route: Route = { screen: "constellation", hostId: "h", constellationId: "c" };

/** A view that mounts with the arrangement, edits what it shows, and unmounts on the next. */
const mount = <T>(store: ReturnType<typeof keptStore<T>>) => {
  const seen: Array<ReadonlyMap<string, T>> = [];
  const unmount = store.subscribe(() => seen.push(store.all()));

  return { unmount, seen };
};

describe("unsent constellation input across postures", () => {
  test("folded → unfolded → half-folded → folded keeps the draft and the claim's answer", () => {
    const drafts = keptStore<string>();
    const choices = keptStore<Unsent>();
    const draftKey = constellationKey("h", "c");
    const slot = taskKey("h", "c", "B2");
    const claim = claimKey({ attemptId: "a1", revision: 3, head: "abc1234" });
    const views: Array<string> = [];

    const steps: ReadonlyArray<[Posture, () => void]> = [
      [FOLDED, () => drafts.set(draftKey, "Hold B3")],
      [unfolded, () => choices.set(slot, typed(chosen(claim, "send-back"), "Missing the test"))],
      [halfFolded, () => drafts.set(draftKey, `${drafts.all().get(draftKey)} until G1`)],
      [FOLDED, () => undefined],
    ];

    for (const [posture, edit] of steps) {
      const shown = arrangementOf(posture, route).kind;
      views.push(shown);
      const view = mount(drafts);
      edit();
      view.unmount();
    }

    // The rail and the span take turns showing the constellation; the input outlives both.
    expect(views).toEqual(["single", "span", "single", "single"]);
    expect(drafts.all().get(draftKey)).toBe("Hold B3 until G1");
    expect(unsentFor(choices.all().get(slot) ?? null, claim)).toEqual({
      claim,
      step: { kind: "reply", verdict: "send-back" },
      draft: "Missing the test",
    });
  });

  test("a replacement claim on the same task starts without the kept answer", () => {
    const choices = keptStore<Unsent>();
    const slot = taskKey("h", "c", "B2");
    const first = claimKey({ attemptId: "a1", revision: 3, head: "abc1234" });
    choices.set(slot, typed(chosen(first, "accept"), "answer for head 1"));
    const second = claimKey({ attemptId: "a2", revision: 4, head: "def5678" });

    expect(unsentFor(choices.all().get(slot) ?? null, second).step).toEqual({ kind: "choose" });
  });

  test("drafts are kept per Host and Constellation, and only a change wakes the views", () => {
    const drafts = keptStore<string>();
    const view = mount(drafts);
    drafts.set(constellationKey("h", "c"), "one");
    drafts.set(constellationKey("h", "c"), "one");
    drafts.set(constellationKey("other", "c"), "two");

    expect(view.seen).toHaveLength(2);
    expect(drafts.all().get(constellationKey("h", "c"))).toBe("one");
  });
});

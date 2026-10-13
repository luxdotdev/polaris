import "../../../test/dom.testing.ts";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { QueueGroup, QueuePull, QueueRow } from "../model/queue.ts";
import { clearDone, doneStore, pullReviewed, useAdvance } from "./advance.ts";
import { reviewedStore } from "./reviewedStore.ts";

const pull = (number: number): QueuePull => ({
  kind: "pull",
  id: `PR_${number}`,
  pull: { repo: { owner: "acme", name: "atlas" }, number, pullId: `PR_${number}` },
  title: `Change ${number}`,
  meta: `#${number}`,
  number,
  url: "",
  head: "head1",
  since: null,
});

const requested = (...rows: ReadonlyArray<QueueRow>): ReadonlyArray<QueueGroup> => [
  { id: "requested", label: "Review requested", rows, compact: false },
];

const SUBMITTED = { commitOid: "head1", at: "2026-10-13T10:00:00Z" };

afterEach(() => {
  cleanup();
  clearDone();
  reviewedStore.setState({ reviews: {} });
});

describe("after a review is submitted", () => {
  test("it is recorded and the queue opens the next pull request of its group", () => {
    const open = mock((_row: QueueRow) => undefined);

    renderHook(() => useAdvance(requested(pull(1), pull(2)), "PR_1", open));
    pullReviewed("PR_1", SUBMITTED);

    expect(reviewedStore.getState().reviews.PR_1).toMatchObject({
      commitOid: "head1",
      at: SUBMITTED.at,
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0].id).toBe("PR_2");
  });

  test("the group's last: the done pane, no row opened", () => {
    const open = mock((_row: QueueRow) => undefined);

    renderHook(() => useAdvance(requested(pull(1)), "PR_1", open));
    pullReviewed("PR_1", SUBMITTED);

    expect(open).not.toHaveBeenCalled();
    expect(doneStore.getState().done).toEqual({ pullId: "PR_1", group: "requested" });
  });

  test("the user moved on while it was submitting: it is recorded, nothing moves", () => {
    const open = mock((_row: QueueRow) => undefined);

    renderHook(() => useAdvance(requested(pull(1), pull(2)), "PR_2", open));
    pullReviewed("PR_1", SUBMITTED);

    expect(reviewedStore.getState().reviews.PR_1).toBeDefined();
    expect(open).not.toHaveBeenCalled();
    expect(doneStore.getState().done).toBeNull();
  });
});

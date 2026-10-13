import "../../../test/dom.testing.ts";
import { SessionId } from "@polaris/protocol";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PolarisApi } from "../../../../shared/api.ts";
import { standInBridge } from "../../bridge.ts";
import type { QueueGroup, QueuePull, QueueSession } from "../model/queue.ts";
import { pullMenuEntries, pullUrlOf } from "./pullMenu.tsx";
import { Queue } from "./Queue.tsx";

const pull = (number: number): QueuePull => ({
  kind: "pull",
  id: `PR_${number}`,
  pull: { repo: { owner: "acme", name: "atlas" }, number, pullId: `PR_${number}` },
  title: `Change ${number}`,
  meta: `#${number} · atlas · mchen`,
  number,
  url: `https://github.com/acme/atlas/pull/${number}`,
  head: "head1",
  since: null,
});

const session: QueueSession = {
  kind: "session",
  id: "local:s1",
  hostKey: "local",
  sessionId: SessionId.make("s1"),
  harness: "claude",
  title: "Layout pass",
  meta: "Turn 3",
};

const GROUPS: ReadonlyArray<QueueGroup> = [
  { id: "requested", label: "Review requested", rows: [pull(1)], compact: false },
  { id: "sessions", label: "Agent sessions ready", rows: [session], compact: false },
  {
    id: "reviewed",
    label: "Reviewed",
    rows: [pull(2), pull(3)],
    compact: true,
    collapsible: true,
  },
];

const show = (reviewedOpen: boolean, onReviewedOpen: (open: boolean) => void = () => undefined) =>
  render(
    <Queue
      groups={GROUPS}
      caption="1 host · 1 workspace"
      selected={null}
      onOpen={() => undefined}
      onOpenPull={() => undefined}
      onList={() => undefined}
      markOf={() => null}
      reviewedOpen={reviewedOpen}
      onReviewedOpen={onReviewedOpen}
    />
  );

const rowIds = (view: ReturnType<typeof render>) =>
  view.queryAllByTestId("review-queue-row").map((r) => r.getAttribute("data-row"));

afterEach(() => {
  cleanup();
  standInBridge(null);
});

describe("the queue's Reviewed group", () => {
  test("closed by default: its header and count, none of its rows", () => {
    const view = show(false);
    const fold = view.getByTestId("review-queue-fold");

    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(fold.textContent).toContain("Reviewed");
    expect(fold.textContent).toContain("2");
    expect(rowIds(view)).toEqual(["PR_1", "local:s1"]);
  });

  test("the header toggles it; open, its rows show", () => {
    const toggled = mock((_open: boolean) => undefined);
    const view = show(false, toggled);

    fireEvent.click(view.getByTestId("review-queue-fold"));
    expect(toggled).toHaveBeenCalledWith(true);

    cleanup();
    expect(rowIds(show(true))).toEqual(["PR_1", "local:s1", "PR_2", "PR_3"]);
  });
});

describe("a row's right-click menu", () => {
  test("a pull request's row opens one; an Agent Session's has none", () => {
    const [pullRow, sessionRow] = show(false).getAllByTestId("review-queue-row");

    // Radix's trigger marks the element it wraps with its open state.
    expect(pullRow?.getAttribute("data-state")).toBe("closed");
    expect(sessionRow?.hasAttribute("data-state")).toBe(false);
  });

  test("Open in GitHub opens the pull request's page; Copy link copies it", () => {
    const request = mock(() => Promise.resolve({ ok: true as const, value: null }));

    standInBridge({
      // SAFETY: the menu only sends `shell.openExternal`, which answers null.
      request: request as PolarisApi["request"],
      subscribe: () => () => undefined,
      onAppEvent: () => () => undefined,
    });

    const url = "https://github.com/acme/atlas/pull/1";
    const items = pullMenuEntries(url);

    expect(items.map((e) => e.label)).toEqual(["Open in GitHub", "Copy link"]);
    items[0]?.onSelect();
    expect(request).toHaveBeenCalledWith("shell.openExternal", { url });
  });

  test("its URL falls back to the pull request's host, Enterprise included", () => {
    expect(pullUrlOf({ repo: { owner: "acme", name: "atlas" }, number: 7 })).toBe(
      "https://github.com/acme/atlas/pull/7"
    );
    expect(
      pullUrlOf({ repo: { host: "ghe.acme.dev", owner: "platform", name: "api" }, number: 12 })
    ).toBe("https://ghe.acme.dev/platform/api/pull/12");
  });
});

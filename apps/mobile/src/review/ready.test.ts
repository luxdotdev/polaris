import { describe, expect, test } from "bun:test";
import type { ConnectionState, HostStreamItem } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "../home/feed/fold.ts";
import {
  minutesAgo,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "../home/fixtures.testing.ts";
import type { HomeHost } from "../home/model/home.ts";
import { readyToReview } from "./ready.ts";

const host = (
  name: string,
  items: ReadonlyArray<HostStreamItem> | null,
  connection: ConnectionState = "connected"
): HomeHost => ({
  hostId: name,
  name,
  connection,
  followed:
    items === null
      ? { state: emptyHostFeed, seen: false, error: null }
      : { state: items.reduce(applyHostItem, emptyHostFeed), seen: true, error: null },
});

const studio = host("Mac Studio", [
  snapshot({
    workspaces: [workspace("w1", "polaris")],
    sessions: [
      summary(
        session({ id: "ended", turnCount: 2, acceptedThroughIndex: 0, updatedAt: minutesAgo(9) })
      ),
      summary(session({ id: "working", state: "working", turnCount: 1 })),
      summary(session({ id: "asking", state: "needs-you", turnCount: 2 })),
      summary(session({ id: "failed", state: "failed", turnCount: 1 })),
      summary(session({ id: "accepted", turnCount: 3, acceptedThroughIndex: 2 })),
      summary(session({ id: "fresh", turnCount: 0 })),
      summary(session({ id: "archived", state: "archived", turnCount: 1 })),
    ],
  }),
  synchronized(),
]);

const vm = host(
  "Linux VM",
  [
    snapshot({
      sessions: [summary(session({ id: "vm-ended", turnCount: 1, updatedAt: minutesAgo(1) }))],
    }),
    synchronized(),
  ],
  "reconnecting"
);

describe("the Review tab", () => {
  test("lists ended sessions with a Turn after the accepted one, across hosts, newest first", () => {
    const ready = readyToReview([studio, vm]);

    expect(ready.rows.map((row) => [row.hostId, row.session.id, row.stale])).toEqual([
      ["Linux VM", "vm-ended", true],
      ["Mac Studio", "ended", false],
    ]);
    expect(ready.rows[1]?.workspaceName).toBe("polaris");
    expect(ready.empty).toBeNull();
  });

  test("says why it is empty: no hosts, none reached yet, or nothing to review", () => {
    expect(readyToReview([]).empty).toBe("no-hosts");
    expect(readyToReview([host("Mac Studio", null)]).empty).toBe("unreachable");
    expect(readyToReview([host("Mac Studio", [snapshot(), synchronized()])]).empty).toBe("none");
  });
});

import { expect, test } from "bun:test";
import { applyHostItem, emptyHostFeed } from "../feed/fold.ts";
import { constellation, session, snapshot, summary, workspace } from "../fixtures.testing.ts";
import { buildHome } from "./home.ts";
import { constellationsOnScreen, homeSections } from "./sections.ts";

const ACTIVE = 200;

const busyHost = {
  hostId: "h1",
  name: "Mac Studio",
  connection: "connected" as const,
  followed: {
    state: applyHostItem(
      emptyHostFeed,
      snapshot({
        workspaces: [workspace("w1", "polaris")],
        sessions: [
          summary(session({ id: "done", state: "idle" })),
          ...Array.from({ length: ACTIVE }, (_, i) =>
            summary(session({ id: `lead${i}`, state: "working" }))
          ),
        ],
        constellations: Array.from({ length: ACTIVE }, (_, i) =>
          constellation(`c${i}`, `lead${i}`)
        ),
      })
    ),
    seen: true,
    error: null,
  },
};

const home = buildHome([busyHost], null);

test("Home lists its sections in order and leaves out empty ones", () => {
  expect(homeSections(home).map((s) => [s.kind, s.count, s.data.length])).toEqual([
    ["working", ACTIVE, ACTIVE],
    ["recent", null, 1],
  ]);
});

test("of hundreds of active constellations, only the rows on screen follow their feed", () => {
  const working = homeSections(home)[0]?.data ?? [];

  const seen = working.map((item, index) => ({ item, isViewable: index < 8 }));
  const header = { item: null, isViewable: true };

  expect([...constellationsOnScreen([header, ...seen])]).toEqual(
    working.slice(0, 8).map((row) => row.key)
  );
});

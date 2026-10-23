import { expect, test } from "bun:test";
import { initialState, onHosts, type AppState } from "./app.ts";
import { entry, host, session } from "./fixtures.testing.ts";
import { layout } from "./layout.ts";
import { clip, tail } from "./sessions.ts";

const long = "👩🏽‍💻é".repeat(300);

const key = { hostId: "h", sessionId: "s" };

const base = onHosts(initialState(true), [
  host("h", [entry(session("s", "idle", { title: long }))], long),
]);

const screens: ReadonlyArray<AppState> = [
  { ...base, hosts: [host("h", [], long)], notice: long },
  { ...base, screen: { kind: "session", key } },
  { ...base, screen: { kind: "menu", key, items: [] } },
  {
    ...base,
    screen: {
      kind: "voice",
      key,
      voice: { requestId: null, phase: "failed", error: long, finalText: "", interimText: "" },
    },
  },
];

test.each(screens.map((state, index) => ({ state, index })))(
  "all text containers fit even with long host names and errors ($index)",
  ({ state }) => {
    const page = layout(state);
    expect(page.texts.length).toBeGreaterThan(0);

    for (const text of page.texts)
      expect(new TextEncoder().encode(text.content).byteLength).toBeLessThanOrEqual(960);
  }
);

test("clipping preserves entire emoji and combining-letter graphemes at either end", () => {
  const text = "👩🏽‍💻é".repeat(20);
  expect(clip(text, 24)).toBe("👩🏽‍💻é…");
  expect(tail(text, 24)).toBe("…é👩🏽‍💻é");
});

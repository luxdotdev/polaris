import { describe, expect, test } from "bun:test";
import type { HostView } from "@polaris/sdk";
import { type AppState, initialState, type Input, onHosts, onInput, onTranscript } from "./app.ts";
import { approval, entry, host, session } from "./fixtures.testing.ts";
import { layout } from "./layout.ts";
import { menuFor } from "./menu.ts";
import { rowLabel, sessionRows } from "./sessions.ts";

const press = (state: AppState, ...inputs: ReadonlyArray<Input>) =>
  inputs.reduce<{ state: AppState; acts: Array<unknown> }>(
    (acc, input) => {
      const [next, act] = onInput(acc.state, input);

      return { state: next, acts: act === null ? acc.acts : [...acc.acts, act] };
    },
    { state, acts: [] }
  );

const click = (index = 0): Input => ({ kind: "click", index });

describe("the Sessions screen", () => {
  test("lists Needs You first, then Working, then Idle, newest first within each", () => {
    const hosts = [
      host("h1", [
        entry(session("idle-new", "idle", { updated: 9 })),
        entry(session("working", "working", { updated: 5 })),
        entry(session("archived", "archived", { updated: 10 })),
      ]),
      host("h2", [
        entry(session("idle-old", "idle", { updated: 1 })),
        entry(session("needs-you", "needs-you", { updated: 0 })),
        entry(session("starting", "starting", { updated: 7 })),
      ]),
    ];

    expect(sessionRows(hosts).map((row) => row.key.sessionId)).toEqual([
      "needs-you",
      "starting",
      "working",
      "idle-new",
      "idle-old",
    ]);
  });

  test("names the Host only when several are paired, and fits a 64-character row", () => {
    const [row] = sessionRows([
      host("h1", [entry(session("s1", "needs-you", { title: "x".repeat(80) }))], "Mac Studio"),
    ]);

    if (row === undefined) throw new Error("no row");
    expect(rowLabel(row, false)).toStartWith("Needs you · xxx");
    expect(rowLabel(row, false)).toHaveLength(64);
    expect(
      rowLabel({ ...row, entry: entry(session("s1", "idle", { title: "Fix it" })) }, true)
    ).toBe("Idle · Fix it · Mac Studio");
  });

  test("a tap opens the selected session; double-tap asks to exit", () => {
    const state = onHosts(initialState(true), [
      host("h1", [
        entry(session("a", "idle", { updated: 2 })),
        entry(session("b", "idle", { updated: 1 })),
      ]),
    ]);

    expect(press(state, click(1)).state.screen).toEqual({
      kind: "session",
      key: { hostId: "h1", sessionId: "b" },
    });
    expect(press(state, { kind: "double-click" }).acts).toEqual([{ kind: "exit" }]);
  });
});

describe("the menu", () => {
  test("offers Approve and Deny for a command, and the options of a question with their full text", () => {
    const command = menuFor(entry(session("s", "needs-you"), [approval("r1", "s")]), null);
    const longOption = `Use ${"the long way ".repeat(8)}`;

    const question = menuFor(
      entry(session("s", "needs-you"), [
        approval("r2", "s", { kind: "question", options: ["Yes", longOption] }),
      ]),
      null
    );

    expect(command.map((item) => item.label)).toEqual(["Approve", "Deny", "Interrupt"]);
    expect(question.map((item) => item.label).slice(0, 3)).toEqual([
      "Yes",
      `${longOption.slice(0, 63).trimEnd()}…`,
      "Speak an answer",
    ]);
    expect(question[1]?.action).toEqual({ kind: "answer", requestId: "r2", text: longOption });
  });

  test("offers Continue only after an interrupted Turn, and replies only when the session isn't working", () => {
    const labels = (state: Parameters<typeof session>[1], last: Parameters<typeof menuFor>[1]) =>
      menuFor(entry(session("s", state)), last).map((item) => item.label);

    expect(labels("idle", "interrupted")).toContain("Continue");
    expect(labels("idle", "completed")).not.toContain("Continue");
    expect(labels("idle", null)).toContain("Speak a reply");
    expect(labels("working", null)).toEqual(["Interrupt"]);
  });

  test("a chosen action runs against the session and returns to it", () => {
    const hosts = [host("h1", [entry(session("s", "needs-you"), [approval("r1", "s")])])];
    const key = { hostId: "h1", sessionId: "s" };

    const state = {
      ...onHosts(initialState(true), hosts),
      screen: { kind: "session", key } as const,
    };

    const { state: after, acts } = press(state, click(), click(1));

    expect(acts).toEqual([{ kind: "run", key, action: { kind: "deny", requestId: "r1" } }]);
    expect(after.screen).toEqual({ kind: "session", key });
  });
});

describe("an approval arriving while the app is open", () => {
  const idle = entry(session("s", "idle"));

  const waiting = entry(session("s", "needs-you", { updated: 3 }), [
    approval("r1", "s", { opened: 3 }),
  ]);

  const other = entry(session("o", "idle"));
  const before: ReadonlyArray<HostView> = [host("h1", [idle, other])];
  const after: ReadonlyArray<HostView> = [host("h1", [waiting, other])];

  test("jumps to its session; approvals already there at launch don't", () => {
    const launched = onHosts(initialState(true), after);

    const browsing = {
      ...onHosts(initialState(true), before),
      screen: { kind: "session", key: { hostId: "h1", sessionId: "o" } } as const,
    };

    expect(launched.screen).toEqual({ kind: "sessions" });
    expect(onHosts(browsing, after).screen).toEqual({
      kind: "session",
      key: { hostId: "h1", sessionId: "s" },
    });
  });

  test("waits while voice is in use, then jumps once the voice screen closes", () => {
    const opened = press(
      {
        ...onHosts(initialState(true), before),
        screen: { kind: "session", key: { hostId: "h1", sessionId: "o" } },
      },
      {
        kind: "long-press",
      }
    ).state;

    const arrived = onHosts(opened, after);

    expect(arrived.screen.kind).toBe("voice");
    expect(press(arrived, { kind: "double-click" }).state.screen).toEqual({
      kind: "session",
      key: { hostId: "h1", sessionId: "s" },
    });
  });
});

describe("voice", () => {
  const key = { hostId: "h1", sessionId: "s" };

  const at = (entries = [entry(session("s", "idle"))]) => ({
    ...onHosts(initialState(true), [host("h1", entries)]),
    screen: { kind: "session", key } as const,
  });

  test("holding listens, releasing stops, and nothing is sent until Send", () => {
    const listening = press(at(), { kind: "long-press" }, { kind: "long-press-release" });

    const heard = onTranscript(listening.state, {
      finalText: "run the tests",
      interimText: "",
      finished: true,
    });

    expect(listening.acts).toEqual([{ kind: "listen", key }, { kind: "stop-listening" }]);
    expect(heard.screen).toMatchObject({ kind: "voice", voice: { phase: "review" } });
    expect(press(heard, click(2)).acts).toEqual([]);
    expect(press(heard, click(0)).acts).toEqual([
      { kind: "send-voice", key, text: "run the tests", requestId: null },
    ]);
  });

  test("answers an open question instead of sending a Turn", () => {
    const asking = at([
      entry(session("s", "needs-you"), [approval("q1", "s", { kind: "question" })]),
    ]);

    const listening = press(asking, { kind: "long-press" }).state;

    const heard = onTranscript(listening, {
      finalText: "the second one",
      interimText: "",
      finished: true,
    });

    expect(press(heard, click(0)).acts).toEqual([
      { kind: "send-voice", key, text: "the second one", requestId: "q1" },
    ]);
  });

  test("an empty transcript offers Retry instead of Send", () => {
    const listening = press(at(), { kind: "long-press" }).state;
    const empty = onTranscript(listening, { finalText: " ", interimText: "", finished: true });

    expect(empty.screen).toMatchObject({
      voice: { phase: "failed", error: "Didn't catch anything" },
    });
    expect(press(empty, click(0)).acts).toEqual([{ kind: "listen", key }]);
  });

  test("shows interim text live", () => {
    const listening = press(at(), { kind: "long-press" }).state;

    const page = layout(
      onTranscript(listening, { finalText: "run the ", interimText: "tes", finished: false })
    );

    expect(page.texts[0]?.content).toContain("run the tes");
  });
});

describe("the glasses' limits", () => {
  test("a long approval stays under the 1,000 characters a page may hold", () => {
    const long = approval("r1", "s", { title: "y".repeat(3000) });

    const state = {
      ...onHosts(initialState(true), [host("h1", [entry(session("s", "needs-you"), [long])])]),
      screen: { kind: "session", key: { hostId: "h1", sessionId: "s" } } as const,
    };

    const content = layout(state).texts[0]?.content ?? "";

    expect(content.length).toBeLessThanOrEqual(1000);
    expect(content).toEndWith("Tap: actions · hold: speak · double-tap: back");
  });

  test("every screen has exactly one container taking input", () => {
    const hosts = [host("h1", [entry(session("s", "needs-you"), [approval("r1", "s")])])];
    const key = { hostId: "h1", sessionId: "s" };
    const base = onHosts(initialState(true), hosts);

    const listening = press(
      { ...base, screen: { kind: "session", key } },
      { kind: "long-press" }
    ).state;

    const states: ReadonlyArray<AppState> = [
      initialState(false),
      initialState(true),
      base,
      { ...base, screen: { kind: "session", key } },
      press({ ...base, screen: { kind: "session", key } }, click()).state,
      listening,
      onTranscript(listening, { finalText: "hi", interimText: "", finished: true }),
    ];

    for (const state of states) {
      const page = layout(state);

      expect([...page.texts, ...page.lists].filter((box) => box.capture)).toHaveLength(1);
    }
  });
});

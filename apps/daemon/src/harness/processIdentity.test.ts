import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { HarnessProcesses } from "./processIdentity.ts";
import { linuxProcessIdentity } from "./processTable.ts";

test("the nearest registered Harness owns descendants; unrelated processes remain the user", () => {
  const table = new Map([
    [10, { parentPid: 1, started: "10" }],
    [20, { parentPid: 10, started: "20" }],
    [30, { parentPid: 20, started: "30" }],
    [40, { parentPid: 1, started: "40" }],
  ]);

  const roots = new HarnessProcesses((pid) => {
    const row = table.get(pid);

    if (!row) throw new Error("process vanished");

    return row;
  });

  const actor = { kind: "agentSession", sessionId: SessionId.make("session-a") } as const;
  const unregister = roots.register(10, actor);
  expect(roots.actorFor(30)).toEqual(actor);
  roots.register(20, { kind: "agentUnattributed", harnessServer: "Codex" });
  expect(roots.actorFor(30)).toEqual({ kind: "agentUnattributed", harnessServer: "Codex" });
  expect(roots.actorFor(40)).toEqual({ kind: "user" });
  table.set(20, { parentPid: 1, started: "reused" });
  expect(roots.actorFor(30)).toEqual({ kind: "user" });
  unregister();
  expect(roots.actorFor(10)).toEqual({ kind: "user" });
  expect(() => roots.actorFor(99)).toThrow("process vanished");
  table.set(40, { parentPid: 40, started: "40" });
  expect(() => roots.actorFor(40)).toThrow("invalid process ancestry");
});

test("Linux comm with spaces and closing parentheses cannot shift parent or process start time", () => {
  const stat = "72 (a tool ) (name)) S 41 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 928 23";
  expect(linuxProcessIdentity(stat)).toEqual({ parentPid: 41, started: "928" });
  expect(() => linuxProcessIdentity("72 (gone) S")).toThrow("invalid /proc stat");
});

test("an old process cleanup cannot remove a newer registration for its PID", () => {
  const roots = new HarnessProcesses(() => ({ parentPid: 1, started: "1" }));
  const old = roots.register(10, { kind: "agentUnattributed", harnessServer: "old" });
  roots.register(10, { kind: "agentUnattributed", harnessServer: "new" });
  old();
  expect(roots.actorFor(10)).toEqual({ kind: "agentUnattributed", harnessServer: "new" });
});

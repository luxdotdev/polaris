import { describe, expect, test } from "bun:test";
import {
  type BlameCommit,
  type OriginSession,
  SessionId,
  TurnId,
  WorkspaceId,
} from "@polaris/protocol";
import {
  ago,
  annotationLead,
  cardGroups,
  footerText,
  type HostOrigins,
  mergeLine,
  noSessions,
  openHint,
  rowTime,
  sessionDetail,
  sessionsText,
} from "./model.ts";

const NOW = new Date(2026, 10, 13, 15, 0).getTime();

const DAY = 86_400_000;

const HOUR = 3_600_000;

const turn = (id: string, number: number, time: number) => ({
  turnId: TurnId.make(id),
  number,
  time,
  prompt: "",
});

const session = (
  id: string,
  title: string,
  turns: ReadonlyArray<ReturnType<typeof turn>>,
  extra: Partial<OriginSession> = {}
): OriginSession => ({
  sessionId: SessionId.make(id),
  workspaceId: WorkspaceId.make("w"),
  title,
  harness: "claude",
  sessionState: "idle",
  archived: false,
  celestial: null,
  turns,
  ...extra,
});

const planning = session("planning", "Polaris planning", [
  turn("p18", 18, NOW - DAY),
  turn("p21", 21, NOW - DAY + 60_000),
  turn("p30", 30, NOW - 60_000),
]);

const spike = session("spike", "Spike GPUI review", [turn("s6", 6, NOW - 2 * DAY)], {
  harness: "codex",
});

const answered = (
  hostKey: string,
  label: string,
  lines: ReadonlyArray<{ line: number; origins: ReadonlyArray<[string, ReadonlyArray<string>]> }>,
  sessions: ReadonlyArray<OriginSession>
): HostOrigins => ({
  hostKey,
  label,
  answer: {
    kind: "answered",
    lines: lines.map((l) => ({
      line: l.line,
      origins: l.origins.map(([s, ts]) => ({
        sessionId: SessionId.make(s),
        turnIds: ts.map((t) => TurnId.make(t)),
      })),
    })),
    sessions,
  },
});

const studio = answered(
  "studio",
  "Mac Studio",
  [{ line: 38, origins: [["planning", ["p18", "p21"]]] }],
  [planning]
);

const vm = answered("vm", "Linux VM", [{ line: 38, origins: [["spike", ["s6"]]] }], [spike]);

const commit: BlameCommit = {
  sha: "8e41d07aa",
  subject: "Session rows show their Celestial",
  authorName: "Lucas Doell",
  authorEmail: "l@example.com",
  time: NOW - DAY - HOUR,
};

describe("merging Hosts' answers", () => {
  test("a line's sessions are the union over Hosts, newest first, with only the Turns that wrote it", () => {
    const merged = mergeLine(38, [studio, vm]);

    expect(
      merged.sessions.map((s) => [s.hostKey, s.session.title, s.turns.map((t) => t.number)])
    ).toEqual([
      ["studio", "Polaris planning", [18, 21]],
      ["vm", "Spike GPUI review", [6]],
    ]);
    expect(sessionDetail(merged.sessions[0]!)).toBe("turns 18–21");
    expect(openHint(merged.sessions[0]!)).toBe("Open at turn 21");
  });

  test("an offline Host still shows the others' sessions and is named", () => {
    const merged = mergeLine(38, [
      studio,
      { hostKey: "vm", label: "Linux VM", answer: { kind: "offline" } },
    ]);

    expect(merged.sessions.map((s) => s.session.title)).toEqual(["Polaris planning"]);
    expect(merged.offline).toEqual(["Linux VM"]);
    expect(footerText(commit, merged)).toBe("1 session · 1 commit · Linux VM offline");
    expect(noSessions(merged)).toBe(false);
  });

  test("a Host still answering doesn't hold back the ones that did", () => {
    const merged = mergeLine(38, [
      studio,
      { hostKey: "vm", label: "Linux VM", answer: { kind: "pending" } },
    ]);

    expect(merged.sessions).toHaveLength(1);
    expect(merged.pending).toBe(1);
    expect(footerText(commit, merged)).toBe("1 session · 1 commit · finding sessions");
  });

  test("the same session answered twice keeps each Turn once", () => {
    const merged = mergeLine(38, [studio, studio]);

    expect(merged.sessions.flatMap((s) => s.turns.map((t) => String(t.turnId)))).toEqual([
      "p18",
      "p21",
    ]);
  });

  test("a line no Host matched has no sessions once all answered", () => {
    const merged = mergeLine(12, [studio, vm]);

    expect(noSessions(merged)).toBe(true);
    expect(footerText(commit, merged)).toBe("1 commit · no sessions");
    expect(footerText(null, merged)).toBe("Not committed · no sessions");
  });
});

describe("the inline annotation", () => {
  test("one session is named by its title; several by their count", () => {
    expect(sessionsText(mergeLine(38, [studio]).sessions)).toBe("Polaris planning");
    expect(sessionsText(mergeLine(38, [studio, vm]).sessions)).toBe("2 sessions");
    expect(sessionsText(mergeLine(12, [studio]).sessions)).toBeNull();
  });

  test("the lead is the author and time, or Not committed", () => {
    expect(annotationLead(commit, NOW)).toBe("Lucas Doell, Yesterday");
    expect(annotationLead(null, NOW)).toBe("Not committed");
  });

  test.each([
    [NOW - 20_000, "now"],
    [NOW - 5 * 60_000, "5 minutes ago"],
    [NOW - 3 * HOUR, "3 hours ago"],
    [NOW - DAY, "Yesterday"],
    [NOW - 2 * DAY, "2 days ago"],
    [NOW - 21 * DAY, "3 weeks ago"],
    [NOW - 120 * DAY, "4 months ago"],
  ])("ago(%p) is %p", (time, words) => {
    expect(ago(time, NOW)).toBe(words);
  });
});

describe("the hover card", () => {
  test("rows group under This week and Earlier, newest first", () => {
    const old = session("study", "Orchestrator layout study", [turn("o9", 9, NOW - 16 * DAY)], {
      archived: true,
      sessionState: "archived",
    });

    const host = answered(
      "studio",
      "Mac Studio",
      [
        {
          line: 38,
          origins: [
            ["planning", ["p18", "p21"]],
            ["study", ["o9"]],
          ],
        },
      ],
      [planning, old]
    );

    const merged = mergeLine(38, [host, vm]);
    const groups = cardGroups(commit, merged, NOW);

    expect(
      groups.map((g) => [
        g.kicker,
        g.rows.map((r) => (r.kind === "commit" ? r.commit.subject : r.line.session.title)),
      ])
    ).toEqual([
      ["This week", ["Polaris planning", "Session rows show their Celestial", "Spike GPUI review"]],
      ["Earlier", ["Orchestrator layout study"]],
    ]);
    expect(sessionDetail(merged.sessions.find((s) => s.session.archived)!)).toBe(
      "turn 9 · Archived"
    );
    expect(footerText(commit, merged)).toBe("3 sessions · 1 commit");
  });

  test("a line not committed groups its sessions under Not committed, a working one says so", () => {
    const live = session("planning", "Polaris planning", [turn("p24", 24, NOW - 10_000)], {
      sessionState: "working",
    });

    const host = answered(
      "studio",
      "Mac Studio",
      [{ line: 20, origins: [["planning", ["p24"]]] }],
      [live]
    );

    const merged = mergeLine(20, [host]);

    expect(cardGroups(null, merged, NOW).map((g) => [g.kicker, g.rows.length])).toEqual([
      ["Not committed", 1],
    ]);
    expect(sessionDetail(merged.sessions[0]!)).toBe("Working · turn 24");
    expect(footerText(null, merged)).toBe("Not committed · 1 session");
  });

  test("a time this week reads as words; earlier as its date", () => {
    expect(rowTime(NOW - 2 * DAY, NOW)).toBe("2 days ago");
    expect(rowTime(new Date(2026, 9, 28, 12).getTime(), NOW)).toBe("Oct 28");
    expect(rowTime(new Date(2025, 9, 28, 12).getTime(), NOW)).toBe("Oct 28, 2025");
  });

  test("Turns a Daemon couldn't number are counted instead", () => {
    const unnumbered = session("x", "X", [turn("a", 0, NOW - 10), turn("b", 0, NOW - 5)]);

    const host = answered(
      "studio",
      "Mac Studio",
      [{ line: 1, origins: [["x", ["a", "b"]]] }],
      [unnumbered]
    );

    const line = mergeLine(1, [host]).sessions[0]!;

    expect(sessionDetail(line)).toBe("2 turns");
    expect(openHint(line)).toBe("Open session");
  });
});

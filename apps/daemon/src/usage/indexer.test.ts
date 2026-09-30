import { afterEach, describe, expect, test } from "bun:test";
import { renameSync, truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openUsageDb } from "./db.ts";
import { discoverLogs, indexFile } from "./indexer.ts";
import {
  claudeLine,
  codexMeta,
  codexTokenCount,
  codexTurnContext,
  type FixtureHost,
  fixtureHost,
} from "./testing.ts";
import { writerOver } from "./writer.ts";

const hosts: Array<FixtureHost> = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.cleanup();
});

const newHost = () => {
  const host = fixtureHost();
  hosts.push(host);

  return host;
};

interface Row {
  native: string;
  model: string;
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  reasoning: number;
  cost: number | null;
}

/** An index over `host`'s logs; `pass` reads what was appended since the last one. */
const index = (host: FixtureHost) => {
  const db = openUsageDb(":memory:");
  const writer = writerOver(db);

  return {
    db,
    writer,
    pass: async () => {
      let read = 0;

      for (const file of discoverLogs(host.env, ["claude", "codex"]))
        read += await indexFile(writer, file);

      return read;
    },
    rows: (harness: string) =>
      db
        .query<Row, [string]>(
          "SELECT native, model, input, cache_read, cache_write, output, reasoning, cost FROM usage WHERE harness = ? ORDER BY ts, id"
        )
        .all(harness),
    total: (harness: string) =>
      db
        .query<{ n: number | null }, [string]>(
          "SELECT SUM(input + cache_read + cache_write + output) AS n FROM usage WHERE harness = ?"
        )
        .get(harness)?.n ?? 0,
  };
};

const claudeFile = (host: FixtureHost, session = "s1", project = "-code-app") =>
  join(host.claudeProjects, project, `${session}.jsonl`);

describe("Claude transcripts", () => {
  test("counts each response once: streamed snapshots of one message collapse to the largest", async () => {
    const host = newHost();
    host.append(
      claudeFile(host),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1", output: 5 }),
      claudeLine({ ts: "2026-09-01T10:00:01Z", msg: "m1", output: 40 }),
      claudeLine({ ts: "2026-09-01T10:05:00Z", msg: "m2", output: 7 }),
      { type: "user", message: { role: "user", content: "hi" } }
    );
    host.appendText(claudeFile(host), "not json at all");

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude").map((r) => [r.output, r.input, r.cache_read, r.cache_write])).toEqual(
      [
        [40, 10, 100, 5],
        [7, 10, 100, 5],
      ]
    );
  });

  test("a response copied into another session's transcript counts once", async () => {
    const host = newHost();
    host.append(
      claudeFile(host, "s1"),
      claudeLine({ session: "s1", ts: "2026-09-01T10:00:00Z", msg: "m1" })
    );
    host.append(
      claudeFile(host, "s2"),
      claudeLine({ session: "s2", ts: "2026-09-01T11:00:00Z", msg: "m1" })
    );
    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude")).toHaveLength(1);
  });

  test("without a request id, only the same session and time is the same response", async () => {
    const host = newHost();
    host.append(
      claudeFile(host),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "gw", req: null }),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "gw", req: null }),
      claudeLine({ ts: "2026-09-01T10:01:00Z", msg: "gw", req: null })
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude")).toHaveLength(2);
  });

  test("a sidechain replay of a parent message is dropped, even with a new request id", async () => {
    const host = newHost();
    host.append(
      claudeFile(host),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1", req: "r1", cacheRead: 500 })
    );
    host.append(
      join(host.claudeProjects, "-code-app", "s1", "subagents", "agent-1.jsonl"),
      claudeLine({
        ts: "2026-09-01T10:00:00Z",
        msg: "m1",
        req: "r2",
        cacheRead: 900,
        sidechain: true,
      }),
      claudeLine({ ts: "2026-09-01T10:02:00Z", msg: "m9", req: "r3", sidechain: true })
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude").map((r) => r.cache_read)).toEqual([500, 100]);
  });

  test("synthetic replies are skipped, fast mode gets its own Model, and reported cost is kept", async () => {
    const host = newHost();
    host.append(
      claudeFile(host),
      claudeLine({
        ts: "2026-09-01T10:00:00Z",
        msg: "a",
        model: "<synthetic>",
        input: 0,
        output: 0,
      }),
      claudeLine({ ts: "2026-09-01T10:00:01Z", msg: "b", speed: "fast" }),
      claudeLine({ ts: "2026-09-01T10:00:02Z", msg: "c", costUSD: 0.25 })
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude").map((r) => [r.model, r.cost])).toEqual([
      ["claude-opus-5-5-fast", null],
      ["claude-opus-5-5", 0.25],
    ]);
  });

  test("advisor iterations count under their own Model", async () => {
    const host = newHost();
    const line = claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1" });

    const usage = {
      ...line.message.usage,
      iterations: [
        { type: "message", usage: { input_tokens: 1, output_tokens: 1 } },
        {
          type: "advisor_message",
          model: "claude-fable-5",
          usage: { input_tokens: 3, output_tokens: 4 },
        },
      ],
    };

    host.append(claudeFile(host), { ...line, message: { ...line.message, usage } });
    const idx = index(host);
    await idx.pass();

    expect(idx.rows("claude").map((r) => [r.model, r.input, r.output])).toEqual([
      ["claude-opus-5-5", 10, 20],
      ["claude-fable-5", 3, 4],
    ]);
  });
});

describe("Codex rollouts", () => {
  const rollout = (host: FixtureHost, name: string) =>
    join(host.codexSessions, "2026", "09", "01", name);

  test("diffs cumulative totals, keeps the Turn delta, and skips totals that didn't advance", async () => {
    const host = newHost();
    host.append(
      rollout(host, "rollout-a.jsonl"),
      codexMeta("thread-a", "2026-09-01T10:00:00Z"),
      codexTurnContext("2026-09-01T10:00:00Z", "gpt-5.5"),
      codexTokenCount("2026-09-01T10:00:01Z", { input: 100, cached: 40, output: 10, reasoning: 2 }),
      codexTokenCount("2026-09-01T10:00:02Z", { input: 100, cached: 40, output: 10, reasoning: 2 }),
      codexTokenCount(
        "2026-09-01T10:00:03Z",
        { input: 300, cached: 140, output: 30 },
        { input: 200, cached: 100, output: 20 }
      )
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("codex")).toEqual([
      {
        native: "thread-a",
        model: "gpt-5.5",
        input: 60,
        cache_read: 40,
        cache_write: 0,
        output: 10,
        reasoning: 2,
        cost: null,
      },
      {
        native: "thread-a",
        model: "gpt-5.5",
        input: 100,
        cache_read: 100,
        cache_write: 0,
        output: 20,
        reasoning: 0,
        cost: null,
      },
    ]);
  });

  test("a fork's replay of its parent's history isn't counted again", async () => {
    const host = newHost();
    host.append(
      rollout(host, "rollout-1-parent.jsonl"),
      codexMeta("parent", "2026-09-01T10:00:00Z"),
      codexTurnContext("2026-09-01T10:00:00Z", "gpt-5.5"),
      codexTokenCount("2026-09-01T10:00:10Z", { input: 100, output: 10 }),
      codexTokenCount("2026-09-01T10:00:20Z", { input: 250, output: 30 })
    );

    host.append(
      rollout(host, "rollout-2-child.jsonl"),
      codexMeta("child", "2026-09-01T10:01:00Z", "parent"),
      codexTurnContext("2026-09-01T10:01:00Z", "gpt-5.5"),
      // The replayed history, with timestamps rewritten to the fork's.
      codexTokenCount("2026-09-01T10:01:00Z", { input: 100, output: 10 }),
      codexTokenCount("2026-09-01T10:01:00Z", { input: 250, output: 30 }),
      codexTokenCount("2026-09-01T10:02:00Z", { input: 300, output: 35 })
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("codex").map((r) => [r.native, r.input, r.output])).toEqual([
      ["parent", 100, 10],
      ["parent", 150, 20],
      ["child", 50, 5],
    ]);
  });

  test("a fork whose parent log is gone skips its head burst", async () => {
    const host = newHost();
    host.append(
      rollout(host, "rollout-child.jsonl"),
      codexMeta("child", "2026-09-01T10:01:00Z", "missing"),
      codexTokenCount("2026-09-01T10:01:00.100Z", { input: 100, output: 10 }),
      codexTokenCount("2026-09-01T10:01:00.200Z", { input: 250, output: 30 }),
      codexTokenCount("2026-09-01T10:05:00Z", { input: 300, output: 35 })
    );

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("codex").map((r) => [r.input, r.output])).toEqual([[50, 5]]);
  });

  test("an archived copy of an active rollout is read once; a moved rollout isn't counted twice", async () => {
    const host = newHost();

    const lines = [
      codexMeta("t", "2026-09-01T10:00:00Z"),
      codexTokenCount("2026-09-01T10:00:01Z", { input: 100, output: 10 }),
    ];

    const active = host.append(rollout(host, "rollout-x.jsonl"), ...lines);
    host.append(
      join(host.home, ".codex", "archived_sessions", "2026", "09", "01", "rollout-x.jsonl"),
      ...lines
    );
    const idx = index(host);
    await idx.pass();
    expect(idx.rows("codex")).toHaveLength(1);

    renameSync(active, join(host.home, ".codex", "archived_sessions", "rollout-x-moved.jsonl"));
    await idx.pass();
    expect(idx.rows("codex")).toHaveLength(1);
  });
});

describe("incremental passes", () => {
  test("read only what was appended, and wait for a line's newline", async () => {
    const host = newHost();

    const file = host.append(
      claudeFile(host),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1" })
    );

    const idx = index(host);
    await idx.pass();
    expect(await idx.pass()).toBe(0);

    const partial = JSON.stringify(claudeLine({ ts: "2026-09-01T10:01:00Z", msg: "m2" }));
    writeFileSync(file, partial.slice(0, 40), { flag: "a" });
    await idx.pass();
    expect(idx.rows("claude")).toHaveLength(1);

    writeFileSync(file, `${partial.slice(40)}\n`, { flag: "a" });
    await idx.pass();
    expect(idx.rows("claude")).toHaveLength(2);
  });

  test("a truncated file is read again from the start without double counting", async () => {
    const host = newHost();

    const file = host.append(
      claudeFile(host),
      claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1" }),
      claudeLine({ ts: "2026-09-01T10:01:00Z", msg: "m2" })
    );

    const idx = index(host);
    await idx.pass();
    const before = idx.total("claude");
    truncateSync(file, 0);
    host.append(file, claudeLine({ ts: "2026-09-01T10:00:00Z", msg: "m1" }));
    await idx.pass();

    expect(idx.total("claude")).toBe(before);
  });

  test("a huge Codex line without a usage type is skipped without buffering it", async () => {
    const host = newHost();
    const file = join(host.codexSessions, "2026", "09", "01", "rollout-big.jsonl");
    host.append(file, codexMeta("big", "2026-09-01T10:00:00Z"), {
      type: "response_item",
      payload: { output: "x".repeat(3 * 1024 * 1024) },
    });
    host.append(file, codexTokenCount("2026-09-01T10:00:01Z", { input: 100, output: 10 }));

    const idx = index(host);
    await idx.pass();

    expect(idx.rows("codex").map((r) => r.input)).toEqual([100]);
  });
});

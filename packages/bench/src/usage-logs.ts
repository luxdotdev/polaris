/**
 * Synthetic Harness logs for the `usage` scenario: Claude Code transcripts and
 * Codex rollouts shaped like real ones (usage lines among much larger content
 * lines, a few multi-megabyte lines), cached under /tmp/polaris-bench/fixtures/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = "/tmp/polaris-bench/fixtures";

/** Bump when the generator changes, so stale caches are not reused. */
const GENERATOR_VERSION = 1;

export interface UsageLogSize {
  readonly claudeSessions: number;
  readonly responsesPerSession: number;
  readonly codexRollouts: number;
  readonly turnsPerRollout: number;
}

export const USAGE_SIZES = {
  full: { claudeSessions: 200, responsesPerSession: 400, codexRollouts: 60, turnsPerRollout: 300 },
  quick: { claudeSessions: 30, responsesPerSession: 200, codexRollouts: 10, turnsPerRollout: 150 },
} as const satisfies Record<string, UsageLogSize>;

/** A deterministic pseudo-random stream (mulberry32), so every cache holds the same bytes. */
const random = (seed: number) => {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const text = (next: () => number, bytes: number) =>
  "lorem ipsum dolor ".repeat(Math.ceil(bytes / 18)).slice(0, Math.floor(bytes * (0.5 + next())));

const iso = (ms: number) => new Date(ms).toISOString();

const START = Date.parse("2026-06-01T00:00:00Z");

const claudeSession = (index: number, size: UsageLogSize): string => {
  const next = random(index + 1);
  const session = `bench-claude-${index}`;
  const lines: Array<string> = [];
  let at = START + index * 3_600_000;

  for (let r = 0; r < size.responsesPerSession; r++) {
    at += 20_000 + Math.floor(next() * 40_000);
    lines.push(
      JSON.stringify({
        type: "user",
        sessionId: session,
        timestamp: iso(at),
        message: { role: "user", content: [{ type: "tool_result", content: text(next, 3000) }] },
      })
    );

    const message = {
      id: `msg_${index}_${r}`,
      model: r % 7 === 0 ? "claude-fable-5" : "claude-opus-5-5",
      role: "assistant",
      content: [{ type: "text", text: text(next, 1500) }],
      usage: {
        input_tokens: 1 + Math.floor(next() * 50),
        output_tokens: 20 + Math.floor(next() * 800),
        cache_read_input_tokens: 20_000 + Math.floor(next() * 80_000),
        cache_creation_input_tokens: Math.floor(next() * 4000),
      },
    };

    const line = {
      type: "assistant",
      sessionId: session,
      timestamp: iso(at),
      version: "2.1.284",
      requestId: `req_${index}_${r}`,
      message,
    };

    lines.push(JSON.stringify(line));

    // Streaming writes the same response more than once.
    if (next() < 0.3) lines.push(JSON.stringify(line));
  }

  return `${lines.join("\n")}\n`;
};

const codexRollout = (index: number, size: UsageLogSize): string => {
  const next = random(10_000 + index);
  const thread = `bench-codex-${index}`;
  let at = START + index * 5_400_000;

  const lines = [
    JSON.stringify({
      timestamp: iso(at),
      type: "session_meta",
      payload: { id: thread, timestamp: iso(at) },
    }),
  ];

  const total = {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };

  for (let t = 0; t < size.turnsPerRollout; t++) {
    at += 30_000 + Math.floor(next() * 60_000);
    lines.push(
      JSON.stringify({
        timestamp: iso(at),
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd: "/work" },
      })
    );
    // Now and then a tool output of a few megabytes.
    const output = t % 97 === 0 ? text(next, 3_000_000) : text(next, 4000);
    lines.push(
      JSON.stringify({
        timestamp: iso(at),
        type: "response_item",
        payload: { type: "function_call_output", output },
      })
    );

    const last = {
      input_tokens: 30_000 + Math.floor(next() * 60_000),
      cached_input_tokens: 0,
      output_tokens: 50 + Math.floor(next() * 1500),
      reasoning_output_tokens: Math.floor(next() * 300),
      total_tokens: 0,
    };

    last.cached_input_tokens = Math.floor(last.input_tokens * 0.8);
    last.total_tokens = last.input_tokens + last.output_tokens;

    total.input_tokens += last.input_tokens;
    total.cached_input_tokens += last.cached_input_tokens;
    total.output_tokens += last.output_tokens;
    total.reasoning_output_tokens += last.reasoning_output_tokens;
    total.total_tokens += last.total_tokens;
    lines.push(
      JSON.stringify({
        timestamp: iso(at + 1),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { ...total }, last_token_usage: last },
        },
      })
    );
  }

  return `${lines.join("\n")}\n`;
};

export interface UsageLogs {
  /** A Claude config directory (with `projects/`), for `CLAUDE_CONFIG_DIR`. */
  readonly claude: string;
  /** A `CODEX_HOME`. */
  readonly codex: string;
  readonly bytes: number;
}

/** The cached log set of `size`: `claude/` (a config dir with `projects/`) and `codex/` (a `CODEX_HOME`). */
export const usageLogs = (name: keyof typeof USAGE_SIZES): UsageLogs => {
  const size = USAGE_SIZES[name];
  const root = join(FIXTURES, `usage-v${GENERATOR_VERSION}-${name}`);
  const claude = join(root, "claude");
  const codex = join(root, "codex");
  const done = join(root, ".done");

  if (!existsSync(done)) {
    rmSync(root, { recursive: true, force: true });
    let bytes = 0;

    for (let i = 0; i < size.claudeSessions; i++) {
      const dir = join(claude, "projects", `-work-project-${i % 12}`);
      mkdirSync(dir, { recursive: true });
      const body = claudeSession(i, size);
      writeFileSync(join(dir, `bench-claude-${i}.jsonl`), body);
      bytes += body.length;
    }

    for (let i = 0; i < size.codexRollouts; i++) {
      const dir = join(codex, "sessions", "2026", "06", String(1 + (i % 28)).padStart(2, "0"));
      mkdirSync(dir, { recursive: true });
      const body = codexRollout(i, size);
      writeFileSync(join(dir, `rollout-2026-06-01T00-00-00-bench-${i}.jsonl`), body);
      bytes += body.length;
    }

    writeFileSync(done, String(bytes));
  }

  return { claude, codex, bytes: Number(readFileSync(done, "utf8")) };
};

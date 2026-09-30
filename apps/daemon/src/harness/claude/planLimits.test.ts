import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PlanLimit, SessionId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Schema, Scope, Stream } from "effect";
import { HarnessEvent } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude, init, rateLimitEvent, result } from "./fakeClaude.ts";
import { emptyClaudeLimitContext } from "../limits/claude.ts";
import { claudePlanLimitReader, USAGE_REFRESH_MS } from "./planLimits.ts";

const getUsage = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
  readFileSync(join(import.meta.dir, "../limits/fixtures/claude-get-usage.json"), "utf8")
);

const until = async (predicate: () => boolean, label: string) => {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;

    await Bun.sleep(2);
  }

  throw new Error(`timed out waiting for ${label}`);
};

/** A Claude session on the fake SDK whose Plan Limits land in `reported`. */
const open = async (options: { readonly reply?: FakeClaude["usageReply"] } = {}) => {
  const fake = new FakeClaude();
  const reported: Array<PlanLimit> = [];

  if (options.reply !== undefined) fake.usageReply = options.reply;

  const driver = makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    planLimits: { report: (limits) => reported.push(...limits) },
  });

  const scope = Effect.runSync(Scope.make());

  const session = await Effect.runPromise(
    driver
      .open({
        sessionId: SessionId.make("session-1"),
        cwd: "/work/repo",
        permissionMode: "supervised",
        model: null,
        effort: null,
        resumeCursor: null,
      })
      .pipe(Scope.provide(scope))
  );

  const events: Array<HarnessEvent> = [];
  Effect.runFork(Stream.runForEach(session.events, (e) => Effect.sync(() => events.push(e))));

  const close = () => Effect.runPromise(Scope.close(scope, Exit.void));

  return { fake, session, reported, events, close };
};

describe("Claude Plan Limits", () => {
  test("asks get_usage once when a session opens and reports every window", async () => {
    const { fake, reported, close } = await open({ reply: getUsage });

    await until(() => reported.length === 3, "the get_usage limits");
    expect(fake.usageCalls).toBe(1);
    expect(reported.map((l) => [l.harness, l.kind, l.scope, l.usedPercent, l.plan])).toEqual([
      ["claude", "five-hour", null, 16, "max"],
      ["claude", "weekly", null, 4, "max"],
      ["claude", "weekly", "Fable", 0, "max"],
    ]);
    await close();
  });

  test("reports rate_limit_event messages during a Turn, with the plan get_usage named", async () => {
    const { fake, session, reported, events, close } = await open({ reply: getUsage });

    await until(() => reported.length === 3, "the get_usage limits");
    await Effect.runPromise(
      session.sendTurn({
        turnId: TurnId.make("turn-1"),
        prompt: "hi",
        attachments: [],
        model: null,
        effort: null,
      })
    );

    const input = await fake.nextInput(0);
    fake.emit(init("claude-1"));
    fake.emit(
      rateLimitEvent({
        status: "allowed_warning",
        rateLimitType: "five_hour",
        resetsAt: 1790671800,
        unifiedWindows: {
          five_hour: { utilization: 0.81, resetsAt: 1790671800 },
          seven_day: { utilization: 0.05, resetsAt: 1791255600 },
        },
      })
    );
    fake.emit(result([input.uuid ?? ""]));

    await until(() => events.some(HarnessEvent.$is("TurnEnded")), "the Turn's end");
    expect(reported.slice(3).map((l) => [l.kind, l.usedPercent, l.status, l.plan])).toEqual([
      ["five-hour", 81, "warning", "max"],
      ["weekly", 5, "ok", "max"],
    ]);
    // The reply at open is fresh, so the Turn's end doesn't ask again.
    expect(fake.usageCalls).toBe(1);
    await close();
  });

  test("an SDK without get_usage, or one that fails it, only means no value", async () => {
    const failing = await open({ reply: new Error("unsupported control request") });

    await until(() => failing.fake.usageCalls === 1, "the get_usage call");
    await Bun.sleep(10);
    expect(failing.reported).toEqual([]);
    await failing.close();
  });

  test("after a Turn, asks get_usage again only once the last answer is a few minutes old", () => {
    let calls = 0;
    let clock = 0;

    const query = {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => {
        calls++;

        return new Promise<never>(() => {});
      },
    };

    const sink = { report: () => {} };
    const context = emptyClaudeLimitContext();
    const reader = claudePlanLimitReader({ sink, context }, query, () => clock);

    reader.read();
    clock = USAGE_REFRESH_MS - 1;
    reader.refresh();
    expect(calls).toBe(1);

    clock = USAGE_REFRESH_MS;
    reader.refresh();
    expect(calls).toBe(2);
  });
});

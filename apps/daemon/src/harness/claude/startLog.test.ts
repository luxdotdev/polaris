import { afterEach, describe, expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { Effect, Exit, Logger, References, Scope } from "effect";
import type { QueryFn } from "./ClaudeDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude, init } from "./fakeClaude.ts";
import { SHADOWED_WARNING, withoutShadowedWarning } from "./sdkWarnings.ts";

const warnings: Array<Error> = [];

const onWarning = (warning: Error) => void warnings.push(warning);

afterEach(() => {
  process.off("warning", onWarning);
  warnings.length = 0;
});

/** Opens a Claude session over `query`, collecting every log line at every level. */
const open = async (query: QueryFn, fake: FakeClaude) => {
  const logs: Array<string> = [];
  const logger = Logger.make((entry) => void logs.push(Logger.formatSimple.log(entry)));
  const scope = Effect.runSync(Scope.make());

  const driver = makeClaudeDriver({
    query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
  });

  await Effect.runPromise(
    driver
      .open({
        sessionId: SessionId.make("session-1"),
        cwd: "/work/repo",
        permissionMode: "full-access",
        model: null,
        effort: null,
        resumeCursor: null,
      })
      .pipe(
        Scope.provide(scope),
        Effect.provide(Logger.layer([logger])),
        Effect.provideService(References.MinimumLogLevel, "All")
      )
  );

  fake.emit({ ...init("claude-session-1"), claude_code_version: "2.1.0" });
  await fake.waitProcessed();

  return {
    logs,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

describe("starting Claude Code", () => {
  test("logs where it starts and when it is ready, per session", async () => {
    const fake = new FakeClaude();
    const t = await open(fake.query, fake);

    const lines = t.logs.filter((line) => line.includes("session session-1:"));
    expect(lines.some((l) => l.includes("starting Claude Code at /opt/bin/claude"))).toBe(true);
    expect(lines.some((l) => l.includes("Claude Code started; waiting"))).toBe(true);
    expect(lines.some((l) => l.includes("Claude Code 2.1.0 ready"))).toBe(true);
    await t.close();
  });

  test("the shadowed canUseTool warning is one debug line, never a process warning", async () => {
    process.on("warning", onWarning);
    const fake = new FakeClaude();

    const query: QueryFn = (input) => {
      process.emitWarning("canUseTool will not be invoked for: Read, Glob", {
        code: SHADOWED_WARNING,
      });

      return fake.query(input);
    };

    const t = await open(query, fake);
    await Bun.sleep(0);

    expect(warnings).toEqual([]);
    const debug = t.logs.filter((line) => line.includes("canUseTool will not be invoked"));
    expect(debug).toHaveLength(1);
    expect(debug[0]).toContain("level=DEBUG");
    await t.close();
  });

  test("other warnings still go through, and the original is put back", () => {
    const seen: Array<unknown> = [];

    const emit = (warning: string | Error, ...rest: Array<unknown>) =>
      void seen.push([warning, ...rest]);

    const target = { emitWarning: emit };

    const result = withoutShadowedWarning(() => {
      target.emitWarning("shadowed", { code: SHADOWED_WARNING });
      target.emitWarning("old style", "Warning", SHADOWED_WARNING);
      target.emitWarning("kept", { code: "OTHER" });

      return 7;
    }, target);

    expect(result).toEqual({ value: 7, shadowed: "shadowed" });
    expect(seen).toEqual([["kept", { code: "OTHER" }]]);
    expect(target.emitWarning).toBe(emit);
  });
});

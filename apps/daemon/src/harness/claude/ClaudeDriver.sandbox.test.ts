/** The Claude driver on a Host where Claude Code's sandbox can't start (Linux without socat). */
import { describe, expect, test } from "bun:test";
import { SessionId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Scope, Stream } from "effect";
import { HarnessEvent, type OpenOptions } from "../HarnessDriver.ts";
import { type ClaudeDriverOptions, makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude, result } from "./fakeClaude.ts";
import { unstamped } from "../itemClock.testing.ts";
import type { ClaudeSandbox } from "./sandbox.ts";

const NO_SOCAT: ClaudeSandbox = { available: false, missing: [{ binary: "socat", pkg: "socat" }] };

// What Claude Code printed on the tester's Linux Host without socat.
const RAW =
  "Sandbox required but unavailable: sandbox is enabled but dependencies are missing: socat not installed · install missing tools (e.g. apt install bubblewrap socat) or see https://code.claude.com/docs/en/sandboxing. Set sandbox.failIfUnavailable=false to allow unsandboxed execution.";

const T1 = TurnId.make("turn-1");

const open = async (overrides: Partial<OpenOptions>, driverOptions: ClaudeDriverOptions) => {
  const fake = new FakeClaude();

  const driver = makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
    ...driverOptions,
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
        ...overrides,
      })
      .pipe(Scope.provide(scope))
  );

  const events: HarnessEvent[] = [];
  Effect.runFork(
    Stream.runForEach(session.events, (e) => Effect.sync(() => void events.push(unstamped(e))))
  );

  return {
    fake,
    session,
    events,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  };
};

describe("Claude driver without the sandbox", () => {
  test("a read-only session has no shell instead of failing", async () => {
    const t = await open({ readOnly: true }, { sandbox: () => NO_SOCAT });
    const o = t.fake.options!;

    expect(o.sandbox).toEqual({ enabled: false });
    expect(o.tools).toEqual(["Read", "Glob", "Grep", "Agent"]);
    expect(o.disallowedTools).toContain("Bash");
    expect(o.permissionMode).toBe("dontAsk");
    expect(o.settingSources).toEqual([]);

    const late = await t.fake.askPermission("Bash", { command: "touch x" }, { toolUseID: "b" });

    expect(late).toMatchObject({ behavior: "deny" });
    await t.close();
  });

  test("an agent session keeps the user's own settings: Polaris sets no sandbox", async () => {
    const t = await open({}, { sandbox: () => NO_SOCAT });

    expect(t.fake.options!.sandbox).toBeUndefined();
    expect(t.fake.options!.settingSources).toEqual(["user", "project", "local"]);
    await t.close();
  });

  test("Claude Code's sandbox failure ends the Turn with a line naming the Host and the fix", async () => {
    const t = await open({}, { hostName: "workbox", sandbox: () => NO_SOCAT });
    await Effect.runPromise(
      t.session.sendTurn({
        turnId: T1,
        prompt: "hi",
        attachments: [],
        model: null,
        effort: null,
      })
    );
    const sent = await t.fake.nextInput(0);
    t.fake.emit(result([sent.uuid!], { subtype: "error_during_execution", errors: [RAW] }));

    for (let i = 0; i < 400 && !t.events.some(HarnessEvent.$is("TurnEnded")); i++)
      await Bun.sleep(2);

    expect(t.events.find(HarnessEvent.$is("TurnEnded"))).toEqual(
      HarnessEvent.TurnEnded({
        turnId: T1,
        status: "failed",
        error:
          "Claude Code's sandbox can't start on workbox: socat isn't installed. Install it (apt install socat), or turn the sandbox off in your Claude Code settings.",
      })
    );
    await t.close();
  });
});

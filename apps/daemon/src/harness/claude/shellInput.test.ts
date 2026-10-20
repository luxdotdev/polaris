import { expect, test } from "bun:test";
import { SessionId, TurnId } from "@polaris/protocol";
import { Effect, Exit, Scope } from "effect";
import type { ShellCommandRun } from "../HarnessDriver.ts";
import { makeClaudeDriver } from "./ClaudeDriver.ts";
import { FakeClaude } from "./fakeClaude.ts";

/** What the Claude driver sends Claude Code for a shell command Turn. */
const sentFor = async (run: ShellCommandRun) => {
  const fake = new FakeClaude();

  const driver = makeClaudeDriver({
    query: fake.query,
    claudePath: () => "/opt/bin/claude",
    stagingDir: "/tmp/polaris-staging",
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

  await Effect.runPromise(
    session.sendTurn({
      turnId: TurnId.make("turn-1"),
      prompt: `! ${run.command}`,
      attachments: [],
      model: null,
      effort: null,
      shellCommand: run,
    })
  );

  const sent = await fake.nextInput(0);

  await Effect.runPromise(Scope.close(scope, Exit.void));

  return sent;
};

const run = (overrides: Partial<ShellCommandRun>): ShellCommandRun => ({
  command: "git status",
  stdout: "",
  stderr: "",
  exitCode: 0,
  failure: null,
  ...overrides,
});

test.each([
  [
    "its output",
    run({ stdout: "On branch main\n", stderr: "hint: x\n" }),
    "<bash-stdout>On branch main</bash-stdout><bash-stderr>hint: x</bash-stderr>",
  ],
  [
    "a non-zero exit",
    run({ stderr: "fatal: not a repo\n", exitCode: 128 }),
    "<bash-stdout></bash-stdout><bash-stderr>fatal: not a repo\nExit code 128</bash-stderr>",
  ],
  [
    "a timeout, after what it printed",
    run({ stdout: "waiting\n", exitCode: null, failure: "timed out after 10 minutes" }),
    "<bash-stdout>waiting</bash-stdout><bash-stderr>Command timed out after 10 minutes</bash-stderr>",
  ],
  [
    "a command that couldn't start",
    run({ exitCode: null, failure: "ENOENT: no such file or directory" }),
    "<bash-stderr>Command failed: ENOENT: no such file or directory</bash-stderr>",
  ],
])(
  "a shell command Turn sends Claude Code its bash mode input and %s",
  async (_, shell, output) => {
    const sent = await sentFor(shell);

    expect(sent.message.content).toEqual([
      { type: "text", text: "<bash-input>git status</bash-input>" },
      { type: "text", text: output },
    ]);
    // Delivered as written: an `@path` or `/command` in the output is never expanded.
    expect(sent.client_composed).toBe(true);
  }
);

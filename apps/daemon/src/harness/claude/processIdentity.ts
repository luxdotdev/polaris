import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { spawn } from "node:child_process";
import type { SessionId } from "@polaris/protocol";
import { harnessProcesses } from "../processIdentity.ts";
import { guardExit } from "../../resources/lostExit.ts";
import { Schema } from "effect";
import { harnessEnv } from "../environment.ts";
import { executableOf } from "../../platform/executable.ts";

const hasPid = Schema.is(Schema.Struct({ pid: Schema.Int }));

/** Wrap the SDK's actual spawn, including shim overrides, before it can run tools. */
export const trackClaudeProcess = (options: Options, sessionId: SessionId): void => {
  if (process.platform === "win32") return;

  const start: NonNullable<Options["spawnClaudeCodeProcess"]> =
    options.spawnClaudeCodeProcess ??
    (({ command, args, cwd, env, signal }) => {
      const child = spawn(executableOf(command), args, {
        cwd,
        env: harnessEnv(env),
        signal,
        stdio: "pipe",
      });

      child.stderr.on("data", (chunk: Buffer) => options.stderr?.(chunk.toString()));
      child.stderr.resume();

      return guardExit(child);
    });

  options.spawnClaudeCodeProcess = (input) => {
    const child = start(input);

    if (!hasPid(child)) return child;
    let unregister: () => void;

    try {
      unregister = harnessProcesses.register(child.pid, { kind: "agentSession", sessionId });
    } catch (error) {
      child.kill("SIGKILL");
      throw error;
    }

    child.once("exit", unregister);
    child.once("error", unregister);

    return child;
  };
};

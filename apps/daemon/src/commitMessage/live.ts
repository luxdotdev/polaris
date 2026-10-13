import { Effect } from "effect";
import { HarnessError } from "../harness/HarnessDriver.ts";
import { connectStdio } from "../harness/codex/RpcConnection.ts";
import { claudeStructured } from "../inline/claude.ts";
import { codexStructured } from "../inline/codex.ts";
import { harnessBinary } from "../inline/live.ts";
import type { MessageBackend } from "./backend.ts";
import { decodeMessage, decodeMessageText } from "./prompt.ts";

export const liveMessage: MessageBackend = Effect.fn("commitMessage.live")(
  function* (harness, job, cwd, progress) {
    const binary = harnessBinary(harness);

    if (!binary)
      return yield* new HarnessError({ harness, message: `${harness} was not found on PATH` });

    return harness === "claude"
      ? yield* decodeMessage(yield* claudeStructured(binary, job, cwd, progress))
      : yield* decodeMessageText(yield* codexStructured(connectStdio(binary), job, cwd, progress));
  }
);

import { InlineError } from "@polaris/protocol";
import { Effect } from "effect";
import { which } from "../service/userPath.ts";
import type { InlineBackend } from "./backend.ts";
import { claudeInline } from "./claude.ts";
import { codexInline } from "./codex.ts";

export const liveInline: InlineBackend = Effect.fn("inline.live")(
  function* (request, cwd, progress) {
    const name = request.harness === "claude" ? "claude" : "codex";

    const binary =
      process.env[request.harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(name);

    if (!binary)
      return yield* new InlineError({
        reason: "harness-failed",
        message: `${name} was not found on PATH`,
      });

    return yield* (request.harness === "claude" ? claudeInline(binary) : codexInline(binary))(
      request,
      cwd,
      progress
    );
  }
);

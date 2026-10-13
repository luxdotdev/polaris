import { InlineError } from "@polaris/protocol";
import { Effect } from "effect";
import { which } from "../service/userPath.ts";
import type { InlineBackend } from "./backend.ts";
import { claudeInline } from "./claude.ts";
import { codexInline } from "./codex.ts";

/** `POLARIS_CLAUDE` / `POLARIS_CODEX` override the PATH lookup; null when neither finds it. */
export const harnessBinary = (harness: "claude" | "codex"): string | null =>
  process.env[harness === "claude" ? "POLARIS_CLAUDE" : "POLARIS_CODEX"] || which(harness) || null;

export const liveInline: InlineBackend = Effect.fn("inline.live")(
  function* (request, cwd, progress) {
    const binary = harnessBinary(request.harness);

    if (!binary)
      return yield* new InlineError({
        reason: "harness-failed",
        message: `${request.harness} was not found on PATH`,
      });

    return yield* (request.harness === "claude" ? claudeInline(binary) : codexInline(binary))(
      request,
      cwd,
      progress
    );
  }
);

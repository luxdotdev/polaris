import type { InlineError, InlinePatch, InlineRequest } from "@polaris/protocol";
import type { Effect, Scope } from "effect";

export type Progress = (text: string) => Effect.Effect<void>;

export type InlineBackend = (
  request: InlineRequest,
  cwd: string,
  progress: Progress
) => Effect.Effect<InlinePatch, InlineError, Scope.Scope>;

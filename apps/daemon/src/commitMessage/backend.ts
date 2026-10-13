import type { HarnessError } from "../harness/HarnessDriver.ts";
import type { StructuredJob } from "../inline/structured.ts";
import type { CommitMessage, CommitMessageError } from "@polaris/protocol";
import type { Effect, Scope } from "effect";

/** Runs one structured job and decodes the Harness's output at the boundary. */
export type MessageBackend = (
  harness: "claude" | "codex",
  job: StructuredJob,
  cwd: string,
  progress: (text: string) => Effect.Effect<void>
) => Effect.Effect<CommitMessage, HarnessError | CommitMessageError, Scope.Scope>;

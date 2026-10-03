import { AttemptId } from "@polaris/protocol";
import { Schema } from "effect";

/** Eligibility loss terminates startup while preserving the healthy Session. */
export class StartupAbandoned extends Schema.TaggedError<StartupAbandoned>()("StartupAbandoned", {
  attemptId: AttemptId,
}) {}

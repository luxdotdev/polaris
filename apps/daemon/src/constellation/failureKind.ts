import type { FailureKind } from "@polaris/protocol";

const CAPACITY =
  /\b(at capacity|usage limit|rate limit|quota|overloaded|too many requests|try a different model|plan limit|budget exceeded|insufficient_quota|429)\b/i;

const TRANSPORT =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|socket|connection|disconnected|unreachable|timed out|network|HTTP ?(401|403|5\d\d)|unauthorized)\b/i;

/**
 * Classify a Harness failure from the text the Harness reported. Codex and Claude
 * surface capacity and transport faults only as prose, so this is a best-effort
 * reading; an unrecognised failure is the Harness's, never the implementation's.
 */
export const classifyFailure = (reason: string | null): FailureKind => {
  if (reason === null) return "harness";

  if (CAPACITY.test(reason)) return "capacity";

  if (TRANSPORT.test(reason)) return "transport";

  return "harness";
};

export const failureKindLabel = (kind: FailureKind): string =>
  ({
    capacity: "model capacity",
    transport: "transport",
    harness: "harness",
    implementation: "implementation",
  })[kind];

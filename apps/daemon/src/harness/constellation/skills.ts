import type { McpBinding } from "../../mcp/binding.ts";
import { Match } from "effect";

export const CONSTELLATION_SKILL_VERSION = 1;

const shared = [
  "Use Polaris tools for this constellation. Repository rules stay in AGENTS.md; read them before changing code.",
  "Use short task ids and worker or Host names. Tool results include the current revision and Next; follow them.",
  "Only the user grants approvals. Hand decisions that belong to the user up, rather than deciding for them.",
  "Message peers through Polaris tools, never by keystrokes in another agent session.",
];

const lead = [
  "Map coarse tasks with plan, then refine. Keep each brief self-contained and declare its Area and acceptance criteria.",
  "Dispatch independent tasks in parallel. Do not poll or wait for status: settles and questions arrive as lead turns.",
  "Review each Claim against its exact head. Merge the branch, run the repository checks, then review Accept with the merged head and receipts.",
  "Send work back with a concrete reason. For a merge conflict, include mergeConflictBase. A sent-back Attempt is new work linked to the previous Attempt.",
  "Use status for detail when an update needs it. Gates count accepted Attempts, not Claims. Hand questions for the user up.",
  "Example from Polaris M2: the accept work reported its branch, commits and checks; review found missing committed-ref cleanup; the follow-up added it and rechecked the work. Use that loop here: review the claimed head, send back omissions, then merge, check and accept the follow-up with receipts.",
];

const worker = [
  "Read the assignment in your first turn. Stay within its Area, or record every outside path and why in the Claim.",
  "Ask the lead or user instead of guessing when a decision is theirs. Use progress for useful facts, not liveness estimates.",
  "Commit on the assigned branch. Before claiming, leave no uncommitted changes and ensure the claimed head belongs to that branch.",
  "Claim with branch, head, commits, check receipts, notDone, followups, questions, outsideArea, decisions and summary.",
  "Take resource leases with polaris lease <name> -- <command>; the lease lasts as long as that command.",
  "Example from Polaris M2: the accept follow-up fixed committed-ref cleanup, reported its change outside the Area in engine/pruning.ts, ran checks and committed. Use that loop here: read the brief, implement, check, commit and claim with receipts and Area exceptions. Ask or explain what is blocking you if you cannot claim.",
];

/** Both variants share one versioned source; delivered only in Harness instruction fields. */
export const constellationInstructions = (binding: McpBinding): string =>
  [
    `Polaris constellation skill · v${CONSTELLATION_SKILL_VERSION}`,
    ...shared,
    ...Match.value(binding).pipe(
      Match.tag("Lead", () => lead),
      Match.tag("Worker", () => worker),
      Match.exhaustive
    ),
  ].join("\n\n");

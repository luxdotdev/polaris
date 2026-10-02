/** Paraphrased loops from the checked-in M2 briefs and reports; no raw transcript is claimed. */
export const m2Examples = {
  sources: [
    ".dagr/briefs/m2/A.md",
    ".dagr/briefs/m2/FX.md",
    ".dagr/reports/m2/A.md",
    ".dagr/reports/m2/FX-accept.md",
    ".dagr/reports/m2/Q-check.md",
  ],
  lead: [
    "M2 loop: the accept report claimed a1ed599 with checks and a fake-GitHub smoke. It disclosed committed refs surviving archive. The fix round assigned that omission back to accept; e32ec1e added cleanup in engine/pruning.ts and a real-repo regression test. Here, review the Claim head and send back that concrete omission with action { _tag: SendBack, reason: Committed refs survive archive; add cleanup and a regression test., worker: { session: accept } }. Include mergeConflictBase when the reason is a merge conflict. Then review the new linked Attempt, merge its exact head, run checks and Accept with mergedHead and receipts. Supply revision from the latest Attempt line in status, not the graph revision or Task revision.",
    "M2 gate: Q-check kept passing flows separate from a seed-dependent reference-model failure, shallow-clone failure and Review frame-budget miss. The initial accept report and FX-accept recorded fake-service smoke evidence and their limits; FX-accept disclosed the first full-suite failure before a successful rerun. Model that as a Gate depending on accepted work. Claims alone never open the Gate. Re-run the named repository checks on the merged result; retain failures and report any user decision instead of calling an unverified result done.",
  ],
  worker: [
    "M2 worker loop: A's brief gave the accept lane, dependencies and fake-GitHub smoke requirements. Its report listed commits, checks, limitations and the cleanup follow-up. FX-accept implemented the follow-up, proved its regression test failed without the cleanup calls, documented engine/pruning.ts outside its Area, and committed e32ec1e. Here, read the rejected Claim and feedback, implement the missing cleanup, run the checks, commit on the assigned branch, and call claim with the complete report. Historical report text is Reported evidence; Verified receipts require a Daemon-recorded command item reference.",
  ],
};

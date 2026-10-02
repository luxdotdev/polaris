// Portions adapted from mattpocock/skills@d28dfdc39beadc3142a33359b5cfa4765dcbd0bc (MIT).
// Upstream licence: docs/licenses/mattpocock-skills.txt.
export const handoverPrompt = (focus: string) =>
  [
    "Write a compact handover summary of this conversation so a fresh Lead can continue the Constellation.",
    "Return the summary in your final reply. Polaris will deliver it; do not write a handoff file or launch another agent.",
    "Include suggested skills, decisions, unfinished work and suggested next steps.",
    "Reference existing specs, plans, ADRs, issues, commits and diffs by path or URL instead of duplicating them.",
    "Redact API keys, passwords and personally identifiable information.",
    "Polaris supplies the graph, Claims, open questions, queued updates, messages in transit and settings from its event log. Do not invent or overwrite those facts.",
    focus === "" ? "" : `The next Lead's focus: ${focus}`,
  ]
    .filter(Boolean)
    .join("\n\n");

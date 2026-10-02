# Constellation skills

`index.ts` is the single versioned instruction source for Lead and worker roles. H's attachment delivers it through Codex's developer instructions and Claude's system-prompt append. It writes no skills into a Workspace. Repository policy stays in that repository's `AGENTS.md`.

`examples.ts` paraphrases the checked-in M2 accept → fix round → gate loop. Its source paths point to briefs and reports in `.dagr`; those reports contain the lead's review and gate decisions. Raw M2 transcripts were not available, so these are report-derived examples. The cleanup omission, follow-up commits, outside-Area calls, failing regression experiment and disclosed gate failures are taken from those reports. Historical check prose remains Reported evidence; live Verified receipts require the store's recorded command output.

Version 2 adds concrete friendly tool inputs, the distinction between graph, Task and Attempt revisions, send-back placement, user-only decisions, complete Claims and Gate acceptance. The eval is `../../mcp/tools/eval.test.ts` and exercises this loop on the scripted bench Harness and real Constellations service/store.

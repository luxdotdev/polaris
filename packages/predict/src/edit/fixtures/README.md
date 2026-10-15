# Scored next-edit replay

The five category JSON files contain only step 4 of the 30 cases from the Polaris next-edit spike, at parent contract commit `d5128595f5f81b95533cb076f281dc46f8d3b490`. Sources: `docs/research/next-edit-spike/scripts/cases.json`, the git commits named there, `raw/zeta-q4-frozen-ngram.jsonl`, `raw/sweep-q8-ngram.jsonl`, their `.labels.json`, and `raw/judgement.json`. No external source code was copied.

Buffers and history are reconstructed by the spike's `buildCase`. Expected and allowed ground-truth files are stored as line patches to avoid repeating whole files. `exact.json` freezes reviewed minimal UTF-16 hunks for the exact-labelled outputs. Tests apply those hunks and independently compare the resulting buffer to the commit-derived ground truths.

The spike's exact rule ignores whitespace and allows extra hunks from the same commit. Zeta `rf01` preserves a one-line ternary where the commit formats it across three lines: it is exact by that rule, but not byte-exact. This is explicitly asserted and reported. Both formats' `rf03` include a second allowed hunk from the same commit. Sweep `rn07` has whitespace-only drift and is an abstention under the spike rule.

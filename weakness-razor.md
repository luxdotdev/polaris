# Bennett's Razor and the Polaris reviewer learning loop

Source: M. T. Bennett, *The Optimal Choice of Hypothesis Is the Weakest, Not the Shortest*, AGI 2023, arXiv:2301.12987v4 (11 Apr 2024). Appendices: github.com/ViscousLemming/Technical-Appendices.

## What the paper says

- **The setting.** Induction goes from a *child* task (the examples you've seen) to an unknown *parent* task (the cases you'll meet later). Many hypotheses fit the child task; the question is which one will generalise (§1, Def. 8).
- **The two proxies compared.** Minimum description length picks the *shortest* hypothesis. **Weakness** picks the hypothesis with the largest *extension*, meaning the one that is compatible with the most possible situations (Def. 7).
- **Results.**
  - *Theory:* if tasks are uniformly distributed, choosing the weakest *valid* hypothesis is both necessary and sufficient to maximise the chance of generalising (Props. 1–2). Shortness is neither necessary nor sufficient (Prop. 3).
  - *Counterexample:* the shortest valid model `{z}` loses to the weaker `{j,k}`.
- **Experiments.** On 8-bit binary addition and multiplication, the weakest model generalised 1.1–5× as often as the shortest, and its "extent" (how much of the answer it got right) was 103–156% of the shortest's (Tables 1–2).
- **"Bennett's Razor"** (§6): *"Explanations should be no more specific than necessary."*
  - Weakness is about extension, not form. A short statement can be very strong ("all things are blue crabs"). A long one can assert almost nothing.
- **Validity comes first.** A hypothesis only counts if it reproduces *every* correct decision on the known examples (Def. 3's models `Mα`). Weakness only ranks candidates that are already valid.

## Caveats before borrowing it

- The proof assumes a **uniform distribution over tasks** and a finite, well-defined vocabulary. Real code review is neither, so the result is a principled heuristic here, not a guarantee.
- The experiments are toy problems (8-bit arithmetic, 75–256 trials per setting), not LLM loops.
- The tweet's advice to "show the model the paper" is an informal practice. Nothing here validates it empirically for agents.

## How it maps onto Polaris

The **child task** is the Verdicts already given in a repo (thumbs-down *and* thumbs-up). The **parent task** is the Findings the reviewer will produce on future changes. A **hypothesis** is a candidate Risk Memory.

A Risk Memory is written as structured conditions: rule or finding kind, path globs, language, code pattern, and similar. That structure gives us a finite vocabulary, so a candidate's "extension" can be *measured*: count how many historical Findings (or code locations) in the repo its conditions match.

### Most useful ideas, ranked

1. **Check validity before ranking.** Replay every candidate Memory against the Workspace's full Verdict history.
   - It must cover all the thumbs-downs it claims to explain.
   - It must hide **zero** thumbs-up (accepted) Findings.
   - Invalid candidates are dropped before anyone sees them.
   - This is the paper's `Mα` requirement, and it matches the regression check recommended in ENG-186.
2. **Rank valid candidates by weakness, not by shortness.** Generate several candidates at different specificities, for example:
   - "this line"
   - "this file"
   - "files whose header contains `@generated`"
   - "`*.gen.ts`"
   - "this rule everywhere"

   Keep the valid ones, then prefer the one whose conditions match the **most** situations. Tie-break toward conditions that make fewer incidental claims (a specific author, date, variable name or file name).
   - This is "no more specific than necessary". It keeps Memories from memorising examples.
   - The validity filter keeps them from sweeping claims that contradict what you've accepted.
   - Don't prefer the shortest wording. "Ignore `*.gen.ts`" is short, but it may be weaker than a longer condition that captures *why* those files are noise.
3. **Measure generalisation the way the paper does:** derive from older Verdicts and test on newer ones.
   - Each proposal shows its backtest: "explains 12/12 dismissals; would have hidden 0 accepted Findings; matches 340 historical Findings; predicted 9/10 later Verdicts".
   - These numbers are what the user sees when approving a batch.
4. **Put the razor in the proposer's instructions.** The agent that drafts Memories (and later, edits to repo review instructions) gets Bennett's Razor plus the validity rule: *propose the least specific rule that explains all the evidence without contradicting any accepted Finding.* This is the cheap version of the tweet's tip, backed by the checks in ideas 1–3.
5. **Retire Memories that stop generalising.**
   - When a new thumbs-up lands on a Finding a Memory would have hidden, the Memory is now *invalid*. Flag it for narrowing or retirement; never keep it silently.
   - Track each Memory's hit rate over time.
6. **Keep the hard floors.**
   - Never suppress secrets or P0 Findings, however "weak" the rule (ENG-186).
   - Weakness is optimised *inside* safety constraints, never across them.

### Beyond Review

The same loop fits any Polaris self-improvement: proposing edits to AGENTS.md or CLAUDE.md after a failed Turn, or the future DAG layer learning gate policies. In every case: collect Verdict-like evidence, generate candidates at several specificities, filter by validity against past evidence, prefer the weakest valid one, backtest on held-out evidence, and have a human approve.

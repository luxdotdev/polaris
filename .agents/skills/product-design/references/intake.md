# Intake: turning new evidence into guidance

Run on demand ("run product-design intake"), after a few design sessions or
a shipped surface. Collection and judgment are separate steps; a human
decision ends every run.

## 1. Collect (evidence only)

Window: since the last line in `decision-log.md`. Gather with links:

- `git log --since=<last-run> --oneline -- DESIGN.md PRODUCT.md CONTEXT.md
  design/ apps/desktop` and read the interesting commits.
- New or changed artboards in the Paper file (`get_basic_info` per page;
  compare names against the exemplars).
- Owner feedback from session transcripts or notes the user pastes in.
- Linear tickets under the Polaris map (ENG-167) closed in the window.
- `coverage-gaps.md` items that recent work may now answer.

## 2. Judge (group, verify, keep pending)

- Group evidence by candidate decision; separate verified facts (accepted
  artboard, stated directive, merged code) from inferences.
- Check each against existing rules and canonical files: duplicate,
  refinement, or new? Does DESIGN.md already own it?

## 3. Packet

Write `docs/design/intake/YYYY-MM-DD.md`: candidates (decision, evidence,
proposed destination, confidence), rejected topics, gaps, follow-ups.

## 4. Human decision

Lucas accepts, rejects, or defers each candidate. Apply accepted ones to
the narrowest destination and append one line each to `decision-log.md`.
Never edit guidance during collect or judge.

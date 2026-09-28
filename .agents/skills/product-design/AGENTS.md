# product-design skill governance

## Load order

Load `SKILL.md` first. Load only the references and exemplars its routing
table points at for the task. Do not bulk-load.

## Rule-change contract

- Add or change guidance only with evidence (an accepted artboard, a
  decision in `decision-log.md`, a stated owner directive, or shipped code)
  and explicit acceptance. Sole approver: Lucas.
- Record scope, rationale, evidence, exceptions, and a bad/good example.
- Prefer the narrowest destination: DESIGN.md / PRODUCT.md / CONTEXT.md
  (canonical, human-owned), a routed reference, an exemplar, or a coverage
  gap.
- Never promote one artboard or one comment into a universal rule by
  itself; record it in the exemplar and promote on the second instance.
- Judgment stays in prose with its evidence. Lint rules come once
  apps/desktop exists.

## Decision log

Every accepted rule, exemplar, or retired rule gets one line in
`decision-log.md`: `date | change | evidence`. Intake reads it to find its
last-run point.

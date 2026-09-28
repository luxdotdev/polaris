# Exemplar: New session

Status: accepted with fixes (owner, 2026-09-28: "The new session page looks
great, these are way better")
Surface: Paper, Orchestrator page, artboard 4 "New session · Night sky ·
Dark".
Why exemplary: the reference for empty states over a pixel scene, and for
text on illustration.

## Decisions worth repeating

### A clearing under text on a scene
- What: kicker, `display` headline "What should happen next?", and the
  where-it-runs line sit on a radial vignette of the scene's darkest colour;
  secondary lines use `text-default`.
- Rules exercised: rule/scene-text-contrast.
- Evidence: owner: "we need to be careful with... the text being accessible
  with its contrast above the input"; commit 2f25851.
- Repeat when: any text sits directly on a scene (cover slides, onboarding).

### Balanced choices, not staggered pills
- What: the Harness choice is one row of three equal 56px cards spanning
  the composer (Claude Code, Codex, Fork a turn) with a 48px watercolour
  tile each; the selected card gets `text-strong`, a brighter hairline, and
  a check.
- Rules exercised: DESIGN.md, New session.
- Evidence: owner: "The staggering of the pills also feels a bit strange -
  these are large and feel a bit off-balance." The dither halo that
  overlapped the pills was removed.
- Repeat when: offering two to four peer choices under an input.

### The cabin is the human touch
- What: the night scene (dawn in light mode) carries a grounded pixel cabin
  with a lit window; both scenes carry it.
- Rules exercised: DESIGN.md, Pixel scenes.
- Evidence: owner: "the dawn scene does lose the cabin... it's
  inconsistent" (fixed in 400e6af); cabin redrawn in b01ec44 after "feels
  like an animal".
- Repeat when: regenerating scenes (`design/scripts/gen_textures.py`).

## Known flaws

- No light (dawn) artboard for this page.

# Exemplar: Settings

Status: proposed (2026-09-29; owner liked the scene-previewed theme cards on S3: "You read my mind!").
Surface: Paper, Settings page: S1 Harnesses (dark), S2 Usage (dark), S3 Appearance (light), S4 Hosts (dark).
Why exemplary: the reference for quiet configuration surfaces that still carry the pixel world through identity (Harness tiles, plan-limit meters) and scenes (theme previews).

## Decisions worth repeating

### Settings replaces the zones, not the window
- What: a 264px sunken nav and one 680px column; esc returns to the Orchestrator.
- Rules exercised: DESIGN.md, Layout (one main window); rule/no-dashboard-clutter.
- Evidence: Mobbin reference, Linear settings; DESIGN.md Settings.

### Availability is neutral, per host
- What: each Harness lists every host with version, availability and one action; no signal colour for "needs sign-in".
- Rules exercised: rule/colour-means-something, rule/remote-is-normal; ADR 0001.
- Evidence: ENG-199 Q9, ENG-201.

### Identity fills meters and charts
- What: plan-limit meters are pixel cells in the Harness hue; the usage chart stacks Harness hues with outside-Polaris usage faded.
- Rules exercised: rule/colour-means-something (Harness hue as identity); DESIGN.md Settings.
- Evidence: ENG-199 Q8, Q17, Q19.

### Scenes preview the theme
- What: Night, Dawn and Match macOS cards use the real scenes.
- Evidence: owner on S3 during the build: "we can have a little fun with this... using the backgrounds that we made as previews".

## Known flaws

- The OpenCode hue is provisional; check it against signals in real screens.
- Only Calm density; no light Harnesses or Usage artboard.
- The Connection State treatment on S4 is not yet accepted (coverage-gaps.md).

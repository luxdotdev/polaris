# Vendored anti-slop

- **Source:** [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), `skills/install-anti-slop/assets/anti-slop/`
- **Commit:** `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10, "Merge pull request #36 from K-Mistele/contrib/effect-tag-match-rules")
- **Licence:** MIT, `LICENSE` in this directory (copied verbatim from the upstream root). `vendor/eslint-stylistic/` is upstream's own vendored copy of ESLint Stylistic (MIT), with its `LICENSE` and `UPSTREAM.md` kept as upstream ships them.
- **Installed at:** `packages/lint-config/plugins/anti-slop/`; registered in `packages/lint-config/oxlint.json` as `anti-slop` (`index.ts`) and `anti-slop-effect` (`effect/index.ts`).

## Local changes

- A one-line provenance header at the top of every `.ts` file. No rule logic, diagnostics or options were changed.
- Nothing else. Sightline's earlier copy (upstream `6d53855`) was byte-identical to upstream, so it carried no local fixes to port.

## Deliberate configuration choices

- Every generic rule, plus the native companion `oxc/no-accumulating-spread`, is on at `error`.
- The Effect plugin is on for every workspace (upstream makes it opt-in; the whole repo is Effect).
- Upstream's tests (`src/**/*.test.ts` in the upstream repo) aren't vendored. The rules are exercised by linting the repo itself; see `../README.md`.

## Updating

Follow upstream's `skills/install-anti-slop/references/update.md`: stage the new upstream snapshot outside this tree, three-way merge against `c44ef22` (the base), keep the header lines, update this file with the new commit, then run `bun run lint` and `bun run test`.

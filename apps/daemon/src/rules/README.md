# Rules

The Rules layer of a Risk Summary (CONTEXT.md: Risk Summary, Risk Finding, Severity): deterministic checks on the lines a change adds, run before and beside the Reviewer. Secrets come from **Betterleaks** (a pinned Go binary beside `polaris`), code patterns from **ast-grep** (`@ast-grep/napi`, embedded) with Polaris's own rule pack. Why these tools, and the measurements behind every choice here: `docs/research/rules-layer.md` (ENG-220); Secret Severity: ENG-230.

## Interface (`index.ts`)

- `Rules` (contract in `services.ts`), `RulesLive`: `run({ cwd, base, head, mode })` → `{ findings, notes, ok }`. Findings are `RiskFinding`s with `source: "rule"`, status `open`.
- `recordRulesLayer(summaryId, request)`: runs the Rules for a started Risk Summary and commits `RiskSummaryLayerChanged` (`running`, then `completed` with any notes or `failed`) and `RiskFindingsRecorded`. Whoever runs the summary (the Reviewer module, M2-V) starts and ends it.
- `findingIdentity`, `secretSeverity`.

`mode` says what `base..head` is:

| Mode | For | Secrets | Patterns |
|---|---|---|---|
| `history` | a pull request's Review Checkout (`mergeBase..head`) | `betterleaks git --log-opts=base..head`: every commit's added lines, so a secret added then removed inside the PR is still reported ("stays in the history") | the changed files at `head`, Findings kept where they overlap an added line |
| `snapshot` | Agent Session Turns (checkpoint commits or trees) | `betterleaks fs` over the changed files at `head`, kept where they overlap an added line | same |

Added lines come from `git diff -U0 -M --diff-filter=AMR` (`addedLines.ts`); a Finding is kept when its line range **overlaps** an added range, so a multi-line match survives when one of its lines changed. Changed files are written from git's objects (`git cat-file --batch`, never the working tree) into a private temp directory (`materialize.ts`), removed after the run.

## Secrets (`secrets/`)

- `pin.ts`: the version and the SHA-256 of each release asset (from the release's `checksums.txt`). One static Linux binary serves glibc and musl.
- `fetch.ts`: downloads and verifies an asset into `node_modules/.cache/polaris-betterleaks/` (the build and tests; never on a Host). `bun scripts/betterleaks.ts fetch` does it by hand.
- `betterleaks.ts`: finds the binary (`POLARIS_BETTERLEAKS`, else beside the compiled `polaris`, else the dev cache), runs it, decodes the v2 JSON report.
  - **Unredacted output, masked here.** `--redact` also rewrites file paths, so the report is read raw and each value is reduced to a masked preview (`mask.ts`: four characters and the length, or a PEM `BEGIN` line) and Betterleaks' SHA-256 fingerprint before anything leaves the module. Nothing stores or sends the value.
  - **No validation.** `-v`/`-a` would send a found credential to its provider; they are never passed, and the child gets a minimal environment (no `BETTERLEAKS_*`, no tokens). Git inside it runs with `core.hooksPath=/dev/null` and `core.fsmonitor=false`.
  - **Config.** `polaris-secrets.toml` (passed as `BETTERLEAKS_CONFIG_TOML`) extends the pinned built-in rules and drops low-confidence matches in translation catalogues. A scanned repo's own config is never loaded (Betterleaks v2 doesn't auto-load one).
- Severity: `high`/`medium` confidence → **Critical**; `low` or none → **Medium**. Confidence 0.9 / 0.6 / 0.3.
- Identity: hash of rule, path and the secret's fingerprint (the same secret in two files is two Findings; a moved line is the same one).

## Patterns (`patterns/`)

- `pack/*.yml`: 28 rules over TS/JS (all parsed as TSX), Python, Go, Rust and shell, each with `metadata.polaris-severity`, a `message` (the Finding's title) and a `note` (its reason: what to do). `fixtures/*.fixture` holds deliberately bad code for each, with safe lookalikes that must not fire.
- `pack.ts`: parses the pack (Effect Schema), applies `files` / `ignores` globs itself (napi only takes `rule`, `constraints`, `utils`).
- `scan.ts`: **one parse and one walk per file**: the file's rules are combined into one `any` to find candidates, then each candidate is checked against each rule with its own constraints (constraints can't be combined: ast-grep applies them after the first matching branch, so one rule's would hide another's match).
- `native.ts`: loads the platform's addon through a literal `require` (how `bun build --compile` embeds an N-API addon) and the Python, Go, Rust and Bash grammars through `type: "file"` imports; compiled builds copy the grammars to `~/.polaris/lib/grammars/` on first use, since native code can't open a file inside the binary. Linux builds pick glibc or musl with `--define process.env.POLARIS_LIBC=…`, so each binary embeds one addon (~10 MB in all).
- `child.ts` / `client.ts`: the scan runs in `polaris rules-scan`, a child process of the same binary (JSON request on stdin, reply on stdout), so ast-grep's synchronous parsing never blocks the Daemon's event loop, a cancelled run kills it, and its memory returns when it exits. 120 s timeout; files over 1 MB are skipped with a note.
- Identity: hash of rule, path, the matched code and two lines either side, whitespace-normalised.

## Shipping

`scripts/build-daemon.ts` puts `betterleaks` in `dist/<platform>/` and lists it in `manifest.json` as `executable`; the Client uploads executables with mode 755 (`packages/client/src/install/remote.ts`) and `polaris install` stages it beside `polaris` (`service/install.ts`, `SIBLING_EXECUTABLES`). `polaris selftest` checks both scanners. Betterleaks' Go modules are audited by `bun scripts/betterleaks.ts audit` (`scripts/betterleaks-licenses.json`), and `bun run licenses:check` enforces the allowlist on them and puts their texts in `THIRD_PARTY_NOTICES.md`. Bump the version: change `pin.ts`, re-run the audit, rebuild.

## Performance

Nothing runs until a Risk Summary asks: no timers, watchers or processes, so an idle Daemon pays nothing. `packages/bench`, scenario `rules` (1,000 changed files, 40,000 added lines, M2 Max): ~1.7 s (history) and ~1.6 s (snapshot), whole process tree peaking at ~440 MiB, of which the `rules-scan` child ~310 MiB and Betterleaks ~35 MiB, all returned when they exit. A Pi 4 is estimated at 8–10× the time (`docs/research/rules-layer.md` §3); not measured on one yet.

`git cat-file --batch` writes its output to a file, not a pipe: Bun 1.3 keeps a large buffer per chunk read from a pipe, and cat-file writes one small chunk per object (1,000 files cost ~550 MB through a pipe).

## Tests

`bun test src/rules` (the first run downloads the pinned Betterleaks into the cache): every pack rule against its fixture, combined vs per-rule matching, added-line parsing, eight synthetic secret formats (generated at test time by `secrets/synthetic.ts`, so no secret-shaped string is committed) in both modes, values never in a Finding, identities stable across line shifts, a missing scanner, and recording the layer into a real store.

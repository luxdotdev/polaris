# Research: the Rules layer, Betterleaks and ast-grep on every Host

Linear: ENG-220 (map ENG-217). Researched 2026-10-01 against primary sources (GitHub releases and source, the projects' own docs, the npm registry) and measured on this machine (MacBook Pro, M2 Max, 12 cores) and in Linux containers (OrbStack, `linux/arm64` native, `linux/amd64` under Rosetta). Every claim links to its source or names the measurement behind it. This builds on [risk-summary.md](risk-summary.md) (ENG-186), which picked Betterleaks and ast-grep for the Rules layer; this ticket checks whether they actually run everywhere a Daemon runs.

## TL;DR

- **Betterleaks is real and is the right secrets scanner.** MIT, made by Gitleaks' authors, first commit 2026-02-03, 2,072 stars, pushed daily. Stable is **v1.9.0** (2026-09-29); **v2.0.0-rc.1** came out the next day and changes the CLI, config and report format. Its release binaries are static Go (`CGO_ENABLED=0`), so one `linux_arm64` and one `linux_x64` file run on glibc *and* musl. Gitleaks is in security-fix-only mode; TruffleHog is AGPL-3.0 and out.
- **ast-grep is MIT, but its CLI does not cover every Host.** The release and npm CLI builds are glibc-only (no musl build at all), 50 MB each, and the x64 one needs glibc 2.34. `@ast-grep/napi` does cover all five Polaris platforms, musl included (7 MB). Verified: napi plus a dynamically loaded Python grammar parses and matches on Alpine arm64.
- **Recommendation:** ship Betterleaks as a pinned, checksum-verified sibling binary next to `polaris` (the manifest already carries extra files). Run ast-grep through `@ast-grep/napi` embedded in the Daemon binary, in a child process or Worker, with Polaris's own rule pack. Do not ship the ast-grep CLI.
- **Speed is not the problem.** On the M2 Max, a 100-commit range (1,133 files, 129,518 added lines) takes Betterleaks 0.3 s and 55 to 90 MB RSS, and the ast-grep CLI 0.24 s on the changed files. A typical Turn-sized diff (318 files, 8,112 lines) takes 0.1 to 0.4 s for either. **Estimated on a Pi 4: 2 to 4 s for the 100-commit range, about 1 to 3 s for a Turn,** with flat memory (about 50 to 70 MB per scanner). These are estimates from 1-CPU and 4-CPU arm64 container runs scaled by Geekbench; they are not measured on a Pi.
- **Only changed lines: Betterleaks already does this; ast-grep needs Polaris to filter.** Betterleaks' `git` source runs `git log -p -U0` and keeps only added lines of each hunk ([source](https://github.com/betterleaks/betterleaks/blob/main/sources/git_patch.go)). ast-grep has no diff mode. Polaris scans the changed files and keeps findings whose range overlaps an added hunk. A prototype of this is about 60 lines and adds about 0.1 to 0.2 s for `git diff -U0`.
- **Output:** use JSON for both, not SARIF. Betterleaks v2 **removed SARIF**, and v1's SARIF has no `level`. ast-grep's SARIF drops rule metadata, the tool version and fingerprints. ast-grep `--json=stream --include-metadata` carries Polaris's own `polaris-severity`. Betterleaks' JSON has `confidence` (high/medium/low), a SHA-256 `match.fingerprint` and a `rule_hash`.
- **False positives, secrets:** on this repo's full history plus two other repos' working trees (Sightline, Parsertime; 13,000 files, 88 MB): **23 findings, all false, 0 high-confidence, 1 medium.** Twenty-two were `low` confidence (i18n strings containing "password", test fixtures). Synthetic credentials of 8 well-known types were all caught at `high` confidence. So: Critical for high/medium confidence, and something lower for `low`. That conflicts with "Critical = secrets, never hidden"; see Decisions.
- **False positives, patterns:** a 28-rule starter pack (TS/JS, Python, Go, Rust, shell). Untuned, it produced 119 findings across the three repos, 97 of them from one rule. After two tuning passes it produced 29. **Excluding Low, 7 of 14 are worth a look (50% precision on whole repos).** On a diff, only new code is checked, so the volume per Review is far smaller. The HEAD~20 range on this repo produced 0 findings on added lines.

---

## 1. What Betterleaks is (and the alternatives)

| | Betterleaks | Gitleaks | TruffleHog |
|---|---|---|---|
| Licence | MIT ([repo](https://github.com/betterleaks/betterleaks)) | MIT | **AGPL-3.0** ([repo](https://github.com/trufflesecurity/trufflehog)) |
| Latest | v1.9.0 stable (2026-09-29), v2.0.0-rc.1 (2026-09-30) ([releases](https://github.com/betterleaks/betterleaks/releases)) | v8.30.1 (2026-03-21) | v3.97.9 (2026-09-24) |
| Status | Active; v2 in RC | "feature complete… security patches only" ([README](https://github.com/gitleaks/gitleaks#readme)) | Active |
| Rules | 464 built-in rule IDs in v2 (`betterleaks config show ids`) | ~same lineage | 700+ verifying detectors |
| Diff-only | `git --log-opts`, `--staged`, `--unstaged` (added lines only) | `git --log-opts` | `--since-commit` |
| Polaris fit | Yes | Superseded by Betterleaks | No: AGPL, outside the licence allowlist (`scripts/licenses.ts`) |

Facts behind "Betterleaks is real", all from GitHub's API and the repo itself:

- The repo `betterleaks/betterleaks` was created on 2026-02-03. It is MIT, has 2,072 stars, and was last pushed on 2026-09-30.
- Its README says it is "maintained by the folks who made Gitleaks, including the original author", and that development is supported by Aikido Security ([README](https://github.com/betterleaks/betterleaks#readme)). Those are the project's claims about itself.
- What it adds over Gitleaks: [Expr](https://expr-lang.org) `prefilter`/`filter` expressions over git attributes (author, path, commit message); BPE "token efficiency" filtering of natural-language strings; optional HTTP validation and permission analysis of live credentials; and Aho-Corasick keyword prefiltering with RE2 (run through wazero). Sources: [README](https://github.com/betterleaks/betterleaks#readme), [v2 migration guide](https://github.com/betterleaks/betterleaks/blob/main/docs/v2_migration.md).
- **Network:** v2 makes provider requests (validation and analysis) opt-in with `-v`/`-a`. "Scans detect secrets without credential provider requests by default" ([README](https://github.com/betterleaks/betterleaks#readme)). Local `git`, `fs` and `stdin` scans are fully offline.

### v1 vs v2: pin which?

v2 is the future (the `main` branch); v1 is maintained on `v1.x`. What changed in v2 that matters to Polaris ([migration guide](https://github.com/betterleaks/betterleaks/blob/main/docs/v2_migration.md)):

- **SARIF, CSV, JUnit and template reporters were removed.** JSON and JSONL remain. JSON is now an envelope `{schema_version: "1", findings, scan}` with a published [JSON Schema](https://github.com/betterleaks/betterleaks/blob/main/docs/schemas/finding.schema.json).
- Findings carry `confidence`, `rule_hash` and `match.fingerprint` (SHA-256 of the secret bytes, or HMAC with `--hmac-key`). The `scan` record has `state: complete|incomplete`, `bytes_scanned` and counts.
- Config is never auto-discovered from the target. A repo's `.betterleaks.toml` / `.gitleaks.toml` is ignored unless passed with `--config`. That is safer for Polaris: a change under Review cannot turn its own scanner off. `gitleaks:allow` / `betterleaks:allow` line comments still work by default (`--no-allow-signatures` turns them off).
- Inline `allowlist` tables are rejected in favour of `filter` expressions, so Gitleaks configs do not load unchanged.
- The release notes say "breaking changes to the CLI, configuration, report formats, and Go API may still land before v2.0.0" ([v2.0.0-rc.1](https://github.com/betterleaks/betterleaks/releases/tag/v2.0.0-rc.1)).

**Recommendation:** build against v2's JSON contract, which is versioned and has a schema, and pin `v2.0.0` once it is final. Until then, pin v1.9.0 or rc.1 and accept one adapter change. Do not build on SARIF from either version.

## 2. Platforms and shipping

### What exists per platform

| Polaris platform | Betterleaks (release tarball) | ast-grep CLI (release zip / npm) | `@ast-grep/napi` (npm) |
|---|---|---|---|
| darwin-arm64 | `darwin_arm64`, 21 MB binary (8.7 MB .tar.gz) | `aarch64-apple-darwin`, 51 MB | `napi-darwin-arm64`, 7.2 MB |
| linux-x64 (glibc) | `linux_x64`, static, 24 MB | `x86_64-unknown-linux-gnu`, 52 MB, **needs glibc ≥ 2.34** | `napi-linux-x64-gnu`, 7.9 MB |
| linux-arm64 (glibc, Pi 4 64-bit) | `linux_arm64`, static, 21 MB | `aarch64-unknown-linux-gnu`, 52 MB, glibc ≥ 2.18 | `napi-linux-arm64-gnu`, 7.7 MB |
| linux-x64-musl | same static `linux_x64` ✔ | **none** | `napi-linux-x64-musl`, 7.2 MB |
| linux-arm64-musl | same static `linux_arm64` ✔ | **none** | `napi-linux-arm64-musl`, 6.7 MB |

Sources: release asset lists from the GitHub API for [betterleaks](https://github.com/betterleaks/betterleaks/releases/tag/v2.0.0-rc.1) and [ast-grep 0.45.3](https://github.com/ast-grep/ast-grep/releases/tag/0.45.3). npm `optionalDependencies` and `libc` fields come from the registry for [`@ast-grep/cli`](https://registry.npmjs.org/@ast-grep/cli/latest) and [`@ast-grep/napi`](https://registry.npmjs.org/@ast-grep/napi/latest). Betterleaks' `.goreleaser.yml` sets `CGO_ENABLED=0` for darwin/linux/windows on amd64 and arm64 ([.goreleaser.yml](https://github.com/betterleaks/betterleaks/blob/main/.goreleaser.yml)).

Verified here:

- `file` reports both Betterleaks Linux binaries as "statically linked". v1.9.0 and v2.0.0-rc.1 ran a 100-commit `git` scan in Debian 13 and Alpine 3.22 on arm64, and v1.9.0 in Debian 13 and Alpine 3.22 on x64 (Rosetta).
- The ast-grep `aarch64-unknown-linux-gnu` binary runs in Debian 13 arm64 but **fails in Alpine** ("not found": no `ld-linux-aarch64.so.1`). The x64 one fails in Alpine with "Dynamic loader not found: /lib64/ld-linux-x86-64.so.2".
- glibc requirements are from `objdump -T`: the x64 CLI needs `GLIBC_2.34` (Debian 12+, Ubuntu 22.04+, RHEL 9+; older LTS Hosts would fail); the arm64 CLI needs `GLIBC_2.18`. Stripping the CLI barely helps (49 MB), because the size is the ~25 tree-sitter grammars compiled in. It gzips to 7 MB.
- **`@ast-grep/napi` 0.45.3 on Alpine arm64 (Bun 1.x):** `parse(Lang.Tsx, …)` matched. `registerDynamicLanguage({ python })` with `@ast-grep/lang-python`'s `prebuild-Linux-ARM64/parser.so` also matched, even though that `.so` is linked against `libc.so.6` (musl's loader resolves the name to itself). Same result on Debian arm64.

### napi and languages

`@ast-grep/napi` has only HTML, JavaScript, TypeScript, TSX and CSS built in. Other languages are loaded with `registerDynamicLanguage` from `@ast-grep/lang-*` packages ([API reference](https://ast-grep.github.io/reference/api.html), [JS API guide](https://ast-grep.github.io/guide/api-usage/js-api.html)). Facts about those packages:

- They are ISC, which is on the allowlist.
- Each ships prebuilt `parser.so` for macOS-ARM64/X64, Linux-ARM64/X64 and Windows-X64 under `prebuilds/` (about 0.5 MB each for Python; Rust's package is 12 MB unpacked). There is no musl-specific prebuild, but the glibc one loads on musl (verified above for Python).
- They are loaded by **file path** (`libraryPath`). Native code cannot read a file embedded in a `bun --compile` binary (`$bunfs`), so the Daemon would have to write the grammars to disk once (for example `~/.polaris/lib/<version>/`). This differs from fff, whose library goes through `bun:ffi`, which Bun loads from `$bunfs` (see `apps/daemon/src/service/README.md`).
- The napi `.node` addon itself can be embedded: Bun documents "Embed N-API Addons… by requiring the file directly" in `--compile` executables ([Bun docs: executables](https://github.com/oven-sh/bun/blob/main/docs/bundler/executables.mdx)). This would follow the same build-time pattern as fff: install the target platform's `@ast-grep/napi-<platform>` package, then compile.

### How each would travel with the Daemon

Today `scripts/build-daemon.ts` writes `dist/<platform>/polaris` plus `manifest.json` with a per-platform `files` map. The Client already uploads "any other files the manifest lists" and checks each one's SHA-256 on the Host (`packages/client/src/install/builds.ts`, `remote.ts`). Two gaps:

1. **Executable bit:** `remote.ts` uploads the first file with mode 755 and every other file with 644. A sibling `betterleaks` would need 755 (or a `chmod` by the Daemon).
2. **Licence gate:** `scripts/licenses.ts` walks npm dependencies only. A downloaded Go binary is invisible to it, so its notices must be added by hand. `go version -m` on the v2 binary lists 39 embedded Go modules: alecthomas/kong, expr-lang/expr, tetratelabs/wazero, betterleaks/go-re2, mholt/archives, klauspost/compress, bodgit/sevenzip, nwaples/rardecode, hashicorp/go-version (MPL-2.0), and others. Their licences look permissive, but **each module was not audited**. Run `go-licenses` (or an equivalent) on the pinned version before shipping.

| Option | Betterleaks | ast-grep |
|---|---|---|
| Sibling binary in `dist/<platform>/` (download pinned release at build time, verify `checksums.txt`; sigstore bundle published too) | **Recommended.** +21 MB per Host upload; one file serves glibc and musl | Glibc only, 50 MB, x64 needs glibc 2.34: **no** |
| Embedded in `polaris` (`--compile`) | Not possible to exec from `$bunfs` (it would have to be extracted at run time anyway) | **Recommended via napi:** +7 MB `.node` embedded, plus grammars written to disk on first use |
| Go SDK / build from source | The Go SDK (`github.com/betterleaks/betterleaks/v2/scan`) can't be used from Bun | Building the CLI for `*-musl` with cargo is possible but adds Rust to CI |
| Run on the Client instead | Would need the diff shipped to the Client; against "the Daemon does the work on the Host" | Same |

Copy vs depend (AGENTS.md *Attribution*): both are **dependencies**, not copied code, so no `ATTRIBUTION.md` entry is needed. Two exceptions: if Polaris adapts a rule from Betterleaks' `config/betterleaks.toml` (MIT) or from ast-grep's [rule catalog](https://ast-grep.github.io/catalog/) into its own pack, that is copying and needs the header and pin. **Never adapt from `semgrep-rules`** (Semgrep Rules License, see [risk-summary.md](risk-summary.md)) or from TruffleHog detectors (AGPL).

## 3. Speed and memory

### Measured, M2 Max (macOS, 12 cores), this repo

| Scan | Size | Betterleaks v1.9.0 | Betterleaks v2.0.0-rc.1 | ast-grep CLI (28 rules) | ast-grep napi, in Bun, serial |
|---|---|---|---|---|---|
| `HEAD~5..HEAD` (Turn-sized) | 318 files, 8,112 added lines, 0.4 MB of patches | 0.13 s, 65 MB | 0.12 s, 54 MB | n/m | 0.43 s, 95 MB process RSS |
| `HEAD~20..HEAD` | 434 files, 15,357 added lines | n/m | n/m | 0.14 s† | 0.68 s, 123 MB |
| `HEAD~100..HEAD` (large) | 1,133 files, 129,518 added lines, 6.0 MB of patches | 0.27–0.60 s, 89 MB | 0.28–0.31 s, 68 MB (`-j 1`: 0.41 s, 60 MB) | 0.24 s† | 2.3 s, 266 MB |
| Full history | 551 commits, 10 MB of patches | 0.38 s, 89 MB | 0.24 s, 81 MB | n/a | n/a |
| Working tree, Sightline | 4,912 files, 53 MB scanned | 0.41 s, 141 MB | 0.81 s, 89 MB | 0.38 s, 24 MB | |
| Working tree, Parsertime | 2,189 files, 27 MB | 0.41 s, 131 MB | 0.43 s, 84 MB | 0.20 s, 30 MB | |

Times are wall clock and memory is max RSS from `/usr/bin/time -l`, best of 3 where repeated. n/m = not measured on macOS (see the Linux table). † Time of the CLI subprocess alone, from the diff-filter prototype; the CLI's own RSS on Linux is in the next table. The napi column is a Bun process that parses each changed file once per rule (13 TSX rules, one `findAll` each, single-threaded). Running each rule as its own `findAll` walk is the main reason it is about 10× the CLI's wall time; the CLI does one pass with all rules across all cores.

### Linux arm64 containers, to estimate a Pi 4

The same scans ran in Debian 13 `linux/arm64` with `--memory=1g`, once with `--cpus=1` and once with `--cpus=4`. These are native arm64 on the M2, through a virtiofs bind mount.

| Scan | 1 CPU | 4 CPUs | RSS |
|---|---|---|---|
| Betterleaks v2, `git HEAD~5..HEAD` | 0.52 s* | 0.35 s* | 51–54 MB |
| Betterleaks v2, `git HEAD~100..HEAD` | 0.59 s | 0.39 s | 56 MB |
| Betterleaks v2, `fs` Sightline (53 MB) | 1.35 s | 0.45 s | 62–71 MB |
| ast-grep CLI, changed files of `HEAD~5` | 0.44 s | 0.13 s | 48–54 MB |
| ast-grep CLI, changed files of `HEAD~100` | 1.26 s | 0.29 s | 49–65 MB |
| ast-grep CLI, Sightline tree | 3.58 s | 0.89 s | 18–23 MB |

\* The first run in each container includes a cold page cache, so HEAD~5 came out slower than HEAD~20 (0.29 s / 0.18 s).

**Pi 4 estimate.** In Geekbench 6, a Pi 4 scores about 250–365 single-core and 620–770 multi-core ([Geekbench Browser: Raspberry Pi 4](https://browser.geekbench.com/search?q=Raspberry+Pi+4)). An M2 Max scores about 2,500–2,850 single-core and 14,300–17,000 multi-core ([Geekbench Browser: MacBook Pro 16-inch 2023, M2 Max](https://browser.geekbench.com/macs/macbook-pro-16-inch-2023-m2-max-30c-gpu)). That is roughly **8–10× per core**. Scaling the arm64 4-CPU numbers by 8–10:

| Workload | Estimated Pi 4 (4 cores) | Memory |
|---|---|---|
| Betterleaks, Turn-sized diff | ~1–3 s | ~50–55 MB |
| Betterleaks, 100-commit range | ~3–4 s | ~55–70 MB |
| ast-grep CLI, Turn-sized diff | ~1–1.5 s | ~50 MB |
| ast-grep CLI, 1,133 changed files | ~2.5–3 s | ~65 MB |
| ast-grep napi (serial, as prototyped), Turn / 1,133 files | ~4 s / ~20 s | process RSS ~100–270 MB |

Caveats:

- An SD card is much slower than an SSD for `git log -p` and file reads, which these numbers do not include.
- The napi row is the weak spot. Before relying on it, (a) combine rules per language into one traversal, or use `findInFiles`, which walks files in Rust threads ([types](https://github.com/ast-grep/ast-grep/blob/main/crates/napi/types/config.d.ts)), and (b) run it off the Daemon's event loop (`findAll` is synchronous).
- **Needs a real Pi run** with `packages/bench` before the decision is final. The Daemon's own `idle` scenario is unaffected, because both scanners run only when a Review or Turn asks for them.

Memory is flat in input size for Betterleaks: reading and detection are streamed with bounded queues ([scanning guide, Parallel jobs](https://github.com/betterleaks/betterleaks/blob/main/docs/scanning.md#parallel-jobs)). Its default is `-j = 4 × GOMAXPROCS` detection workers; `-j 2` on a Pi lowers peak memory at little cost (`-j 1` was 0.41 s vs 0.29 s here).

## 4. Scanning only the changed lines

### Betterleaks: built in

- `betterleaks git <repo> --log-opts="<base>..<head>"` runs `git -C <repo> log -p -U0 <opts>`. The `readGitPatch` parser "retains only the additions in the current hunk", with hunk boundaries kept so multiline rules still work ([sources/git.go](https://github.com/betterleaks/betterleaks/blob/main/sources/git.go), [sources/git_patch.go](https://github.com/betterleaks/betterleaks/blob/main/sources/git_patch.go)). Findings carry the new-file `start_line`, plus the commit SHA, author and a web link in `attributes` (verified on this repo: `FakeServer.ts:56` matched the file at HEAD).
- Because it walks commits, a secret added in commit 1 and deleted in commit 3 of a PR is **still reported**. That is right for a PR: the secret is in history once merged.
- `--staged` (index vs HEAD) and `--unstaged` (tracked working tree vs index) scan added lines only, and neither scans untracked files ([migration guide](https://github.com/betterleaks/betterleaks/blob/main/docs/v2_migration.md)).
- **An Agent Session's Turn diff does not fit either mode.** Polaris snapshots a Turn as a *tree* in its own index (`apps/daemon/src/git/snapshot.ts`), not a commit or the user's index. Two ways to scan "tree A → tree B":
  1. `git commit-tree` a throwaway commit for each tree (B's parent = A's commit), then use `--log-opts "<cA>..<cB>"`. This creates unreferenced objects only and touches no ref, index or HEAD.
  2. Run `betterleaks fs` on the files changed between the trees, then keep findings on added lines, exactly as for ast-grep below. This is simpler and reuses one filter for both tools.

  Piping `git diff` into `betterleaks stdin` is **not** a good option: it would scan removed lines and headers, and lose the per-file `path` that prefilters use.

### ast-grep: Polaris filters

ast-grep has no diff mode; `scan` takes paths ([scan reference](https://ast-grep.github.io/reference/cli/scan.html)). The prototype that produced the numbers in §3:

1. `git diff -U0 --no-color --no-ext-diff --diff-filter=AMR <base> <head>`, then parse `+++ b/<path>` and `@@ -a,b +c,d @@` into added ranges `[c, c+d-1]` (skipping `d = 0`).
2. Scan only those files, with the CLI given paths or with napi per file.
3. Keep a finding if its range overlaps an added range. Use overlap, not start line: a multi-line match such as an `exec(` call whose argument changed must survive.

On this repo the filter matters: `HEAD~20..HEAD` had 6 CLI findings in changed files but **0 on added lines**, and `HEAD~100..HEAD` had 15 and 13. Findings in changed-but-untouched code are pre-existing. They could be shown separately (Claude Code Review's "pre-existing" severity, see [risk-summary.md](risk-summary.md)) or dropped.

## 5. Output and mapping onto Risk Findings

| | Betterleaks v2 JSON | Betterleaks v1 SARIF | ast-grep `--json=stream --include-metadata` | ast-grep `--format sarif` |
|---|---|---|---|---|
| Location | `location.path`, 1-based `start_line`/`end_line`, columns | `physicalLocation.region` | `file`, **0-based** `range.start.line`/`column`, byte offsets | 1-based `region` |
| Rule | `rule_id`, `description`, `rule_hash` | `ruleId`, `driver.rules[]` | `ruleId`, `message`, `note`, `severity` | `ruleId`, `message`; **no `driver.rules`, no tool version** |
| Severity-ish | `confidence`: high/medium/low/""; `analysis.severity` only with `--analyze` (network) | **no `level`** on results | `severity` (error/warning/info/hint), `metadata` (our `polaris-severity`) | `level` from severity; **metadata dropped** |
| Fingerprint | `match.fingerprint` = SHA-256 of the secret value (or HMAC) | `partialFingerprints`: commit, author, date, message (no content hash) | none | none |
| Paths | as given | as given | as given (absolute if given absolute) | absolute URIs |

Verified on real output from both tools (§3 runs). Schemas: Betterleaks [finding.schema.json](https://github.com/betterleaks/betterleaks/blob/main/docs/schemas/finding.schema.json); ast-grep [scan CLI](https://ast-grep.github.io/reference/cli/scan.html) and [severity guide](https://ast-grep.github.io/guide/project/severity.html).

**Use JSON from both.** SARIF loses information in both tools, and Polaris builds its own Risk Finding anyway. ENG-185's SARIF levels (error/error/warning/note) apply only if Polaris *exports* SARIF later.

Proposed mapping (to the record sketched in [risk-summary.md](risk-summary.md) §3):

| Risk Finding field | From Betterleaks | From ast-grep |
|---|---|---|
| source | Rule, tool `betterleaks@<version>`, `rule_id`, `rule_hash` | Rule, tool `ast-grep@<version>`, `ruleId`, plus a hash of the rule YAML |
| Severity | **Critical** if `confidence` is high or medium (or `analysis.status = valid`); **Medium** if `low` or unclassified (see Decisions) | `metadata.polaris-severity`; fall back to error→High, warning→Medium, info/hint→Low |
| confidence | high 0.9, medium 0.6, low 0.3 (to tune from Verdicts) | per rule, in `metadata` (start at 0.7, lower for broad rules) |
| reason | `description` (already phrased as a risk, for example "…which may expose account credentials") | `message` (+ `note`) |
| location | path + 1-based lines | path + (0-based line + 1) |
| fingerprint | hash(`rule_id`, path, `match.fingerprint`). Not `match.fingerprint` alone, because one secret reused in two files would collapse into one finding | hash(`ruleId`, path, whitespace-normalised matched text) |
| evidence | **never the secret**: a masked preview only (first 4 characters + length) | `lines` / `text` |

**Redaction trap (v2.0.0-rc.1, observed):** `--redact` replaced the secret's value *everywhere in the finding, including `location.path`*. The test password `analyst` turned `test/analyst/analyst-prisma.test.ts` into `test/REDACTED/REDACTED-prisma.test.ts` (v1.9.0 kept the path). So run without `--redact`, read the stream into the Daemon, and mask before anything is persisted or sent. The raw value should exist only in that process's memory, long enough to hash it.

## 6. A starting rule pack

### Secrets: Betterleaks' defaults plus a Polaris config

Start from Betterleaks' embedded default rules (464 IDs). Its README recommends maintaining "your own config instead of extending the upstream default config directly", so that upgrades don't silently change detection ([README](https://github.com/betterleaks/betterleaks#readme)). Polaris should ship a pinned `polaris-secrets.toml` that extends the defaults and adds global filters:

- skip i18n catalogues (`**/messages/*.json`, `**/locales/**`, `**/i18n/**`) for the `generic-password` rule. 18 of 23 false positives were two i18n keys (`"password": "Password (…)"` and `"incorrectPassword": "Incorrect password"`) repeated across locale files;
- treat `low`-confidence findings in test paths (`*.test.*`, `test/`, `testing/`, `__fixtures__/`) as Low, or drop them.

### Patterns: ast-grep, 28 rules

The pack is in the appendix. It parses every JS/TS file with the TSX grammar (`languageGlobs`), so one rule covers `.ts/.tsx/.js/.jsx/.mjs/.cjs`. Every rule fired on a fixture of deliberately bad code, and none fired on the "safe lookalike" lines in the same fixtures.

| Language | Critical | High | Medium | Low |
|---|---|---|---|---|
| TS/JS | `eval`/`new Function`; shell command from interpolation (`exec` with template/concat); TLS verification off; raw SQL from a template (`$queryRawUnsafe`, `.query(\`…${}\`)`) | `shell: true`; raw HTML (`innerHTML`, `dangerouslySetInnerHTML`, `document.write`); focused test (`.only`) | MD5/SHA-1; CORS `*`; skipped test; `debugger` | `@ts-ignore`; recursive delete (outside tests/scripts) |
| Python | `eval`/`exec`; pickle/`yaml.load`/marshal; `verify=False`; SQL via f-string/`%`/`.format` into `execute` | `subprocess(..., shell=True)`; `os.system`/`os.popen` | MD5/SHA-1 (unless `usedforsecurity=False`) | bare `except:` |
| Go | `InsecureSkipVerify: true`; `Query/Exec(fmt.Sprintf(…))` | `exec.Command(sh, "-c", …)` | | |
| Rust | `danger_accept_invalid_certs(true)` | | `unsafe { }` without a `// SAFETY` comment | |
| Shell | `rm -rf $VAR/` (empty variable deletes the wrong tree) | `curl … \| sh` | | |

Not covered, and worth a decision: **SQL migrations** (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, which are data loss and so Critical). ast-grep has no SQL grammar built in, so these need a small line-regex rule set of Polaris's own, or a dynamic SQL grammar. Also not covered: lockfile and CI-config changes (`.github/workflows`, `permissions: write-all`, `pull_request_target`). ast-grep does have YAML built in.

### False-positive rate, measured

Method: the tracked files of each repo (`rg --files`, which respects `.gitignore`, so hidden files such as `.env.example` and `.github/` were not included), copied read-only into a scratch directory, plus this repo's full git history for Betterleaks. I triaged each finding by reading the line.

**Betterleaks (v2.0.0-rc.1 defaults; v1.9.0 found the same set):**

| Corpus | Findings | high | medium | low | True positives |
|---|---|---|---|---|---|
| Polaris, full history (551 commits) | 1 | 0 | 0 | 1 | 0 (test fake `password = "fake-password"`) |
| Polaris, working tree (1,299 files) | 1 | 0 | 0 | 1 | 0 (same) |
| Sightline (4,912 files) | 15 | 0 | 1 | 14 | 0: 12 i18n strings, 1 OAuth scope string `"ranked:write"`, 1 Discord user ID in a test (medium), 1 test DB URL to `127.0.0.1:1` |
| Parsertime (2,189 files) | 7 | 0 | 0 | 7 | 0: 6 i18n strings, 1 test `FLAGS_SECRET` |
| Synthetic (random, never-issued keys in real formats) | 8 of 10 cases | 7 | 0 | 1 | 8: GitHub PAT, AWS key, Slack bot, Stripe live, OpenAI, Anthropic, RSA private key (high); hex `api_key` (low) |

The two synthetic misses were intended or reasonable:

- a Postgres URL whose host was `db.internal.example.net` was dropped by the placeholder filter. With a non-`example` host it was found (`generic-credential-uri`, medium);
- a GCP `private_key_id` alone is not a secret.

**Precision: 0 of 23 real-repo findings were true; every false one was `low` except one `medium`.** Mapping `low` to Critical would make every one of these an unhideable top-of-list finding. Mapping only high/medium to Critical leaves 1 false Critical in ~13,000 files, plus history.

**ast-grep starter pack (whole working trees; worst case, since diffs check only new code):**

| Corpus | Untuned hits | After tuning | Of which not Low | Worth a look (my triage) |
|---|---|---|---|---|
| Polaris (1,299 files) | 97 (all `js-recursive-delete`) | 15 (all Low recursive-delete, legitimate temp-dir cleanup) | 0 | 0 |
| Sightline (4,912 files) | 17 | 10 | 10 | 5: hand-escaped `SET TRANSACTION SNAPSHOT '${…}'`; `unsafe { MoveFileExW(…) }` without SAFETY; CORS `*` on an HTTP handler; `dangerouslySetInnerHTML={{ __html: data.content }}`; `__html: children ?? highlightedPath` |
| Parsertime (2,189 files) | 5 | 4 | 4 | 2: the same two `dangerouslySetInnerHTML` patterns |

Tuning was two changes:

- `js-recursive-delete` moved to Low and ignores tests and scripts (97 → 15);
- `dangerouslySetInnerHTML` skips inline `<script>`/`<style>` and SCREAMING_CASE constants, and Python MD5 skips `usedforsecurity=False`.

Remaining false positives: escaped identifiers in `DROP TABLE raw.${ident(…)}`; a constant in `SET LOCAL statement_timeout = '${CONST}'`; shadcn's `chart.tsx` style injection; MD5 used as an asset checksum; `test.todo`. "Worth a look" is a reviewer's judgement, not a confirmed bug. **About 50% precision for non-Low findings on whole repos.** That is fine for Medium ("worth a look") but too low for the three `*-sql-*` rules at Critical, which were 1 of 3. Start the SQL rules at High and let Verdicts move them.

## Decisions the tickets need to make

1. **Critical vs `low`-confidence secrets.** CONTEXT.md makes secrets Critical and says no Risk Memory may hide a Critical Finding. Betterleaks' `generic-*` rules (password, api-key, credential-uri) produced every false positive measured, all `low`. Options:
   - (a) Severity from confidence: high/medium → Critical, low → Medium. Low ones can then be dismissed and learned from.
   - (b) Keep every secret Critical, but suppress `low` in test/i18n paths through Polaris's config.
   - (c) A Polaris-owned allowlist that is *not* a Risk Memory.

   Recommend (a). It keeps the "never hidden" promise for anything that looks like a real credential.
2. **ast-grep: napi in-process vs CLI subprocess.** The CLI is 10× faster here but glibc-only (no Alpine), 50 MB, and needs glibc 2.34 on x64. napi covers every platform at 7 MB but needs grammars on disk, its own rule loading (severity, message, `ignores` and `files` are CLI-only; napi takes `rule`/`constraints`/`utils` only, per [`NapiConfig`](https://ast-grep.github.io/reference/api.html)), and must run off the event loop. Recommend napi in a `polaris` child process (a subcommand of the same binary). Memory then returns to baseline after each scan, the work can be killed on cancel, and it fits the process-tree sampler in `packages/bench`.
3. **Betterleaks pin.** Pick between v1.9.0 now (stable; SARIF available but unused) and v2.0.0-rc.1 / v2.0.0 (versioned JSON schema, no target config auto-load). Recommend designing for v2 JSON.
4. **Turn diffs:** throwaway commits from snapshot trees (exact history semantics) or `fs` + added-line filter (one code path for both tools). Recommend the filter for Turns and `--log-opts base..head` for a PR's Review Checkout.
5. **Manifest:** sibling files need an executable mode in `manifest.json` / `remote.ts`, and `licenses.ts` needs a way to record non-npm binaries (Betterleaks plus its 39 Go modules).
6. **Validation is off.** Never pass `-v`/`-a` by default: it sends a found credential to its provider. If it is ever offered, make it a per-Workspace opt-in (as risk-summary.md said of TruffleHog).
7. **Who owns the rule pack.** It lives in Polaris and is versioned with the Daemon. A repo can add rules (`.polaris/rules/*.yml`) but cannot turn off Critical secret rules. This needs its own small decision with Risk Memory (ENG-186's open questions).

## Open questions

- Real Raspberry Pi 4 numbers (SD card and 4 GB / 8 GB) with `packages/bench`. The estimates above are scaled from the M2.
- napi throughput with rules combined per language, or with `findInFiles`; the prototype's per-rule `findAll` is the slow path.
- A licence audit of the 39 Go modules inside the Betterleaks binary (`go-licenses report`).
- Whether v2.0.0 final keeps the JSON schema at `"1"` (the RC says breaking changes may still land).
- Python, Go and Rust precision. Sightline has only 222 `.py` and 18 `.rs` files, so the non-TS rules saw little real code.

## Appendix: the starter ast-grep rule pack

`sgconfig.yml`:

```yaml
ruleDirs:
  - rules
# Parse every JS/TS flavour with the TSX grammar, so one rule covers .ts/.tsx/.js/.jsx/.mjs/.cjs.
languageGlobs:
  tsx: ["*.ts", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs", "*.jsx"]
```

<details>
<summary>rules/*.yml (28 rules, ast-grep 0.45.3)</summary>

```yaml
# rules/tsx.yml
id: js-eval
language: tsx
severity: error
message: eval runs a string as code
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - pattern: eval($$)
    - pattern: new Function($$)
---
id: js-shell-interpolation
language: tsx
severity: error
message: A shell command built from interpolated values can be injected
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - pattern: $F($CMD, $$)
    - pattern: $F($CMD)
constraints:
  F: { regex: '^(exec|execSync|child_process\.exec|child_process\.execSync|cp\.exec|cp\.execSync)
```

</details>
 }
  CMD:
    any:
      - kind: template_string
        has: { kind: template_substitution }
      - kind: binary_expression
        regex: '\+'
---
id: js-shell-true
language: tsx
severity: warning
message: "spawn with shell: true passes arguments through a shell"
metadata: { polaris-severity: High, category: security }
rule:
  kind: pair
  regex: '^shell:\s*true
```

</details>

  inside: { kind: arguments, stopBy: end }
---
id: js-tls-verification-off
language: tsx
severity: error
message: TLS certificate verification is turned off
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - kind: pair
      regex: '^rejectUnauthorized:\s*false
```

</details>

    - pattern: process.env.NODE_TLS_REJECT_UNAUTHORIZED = $V
---
id: js-raw-sql-unsafe
language: tsx
severity: error
message: Raw SQL built from interpolated values can be injected
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - pattern: $DB.$M($Q, $$)
    - pattern: $DB.$M($Q)
constraints:
  M: { regex: '^(\$queryRawUnsafe|\$executeRawUnsafe|unsafe|raw|query|execute)
```

</details>
 }
  Q:
    kind: template_string
    has: { kind: template_substitution }
---
id: js-dangerous-html
language: tsx
severity: warning
message: Raw HTML is inserted into the page
metadata: { polaris-severity: High, category: security }
rule:
  any:
    - pattern: $E.innerHTML = $V
    - pattern: $E.outerHTML = $V
    - pattern: document.write($$)
    - kind: jsx_attribute
      has: { kind: property_identifier, regex: '^dangerouslySetInnerHTML
```

</details>
 }
      # Inline <script>/<style> and SCREAMING_CASE constants are author-controlled.
      not:
        any:
          - inside: { kind: jsx_self_closing_element, regex: '^<(script|style)\b' }
          - inside: { kind: jsx_element, has: { kind: jsx_opening_element, regex: '^<(script|style)\b' } }
          - regex: '__html:\s*[A-Z][A-Z0-9_]*\s*\}'
---
id: js-weak-hash
language: tsx
severity: warning
message: MD5 and SHA-1 are broken for security uses
metadata: { polaris-severity: Medium, category: security }
rule:
  any:
    - pattern: createHash($ALG)
    - pattern: $C.createHash($ALG)
constraints:
  ALG: { regex: '^["''](md5|sha1)["'']
```

</details>
 }
---
id: js-cors-wildcard
language: tsx
severity: warning
message: CORS allows every origin
metadata: { polaris-severity: Medium, category: security }
rule:
  kind: pair
  all:
    - has: { field: key, regex: '(?i)^["'']?access-control-allow-origin["'']?
```

</details>
 }
    - has: { field: value, regex: '^["'']\*["'']
```

</details>
 }
---
id: js-focused-test
language: tsx
severity: error
message: A focused test (.only) silently skips every other test
metadata: { polaris-severity: High, category: correctness }
rule:
  pattern: $T.only($$)
constraints:
  T: { regex: '^(it|test|describe|suite|context)
```

</details>
 }
---
id: js-skipped-test
language: tsx
severity: warning
message: A test is skipped
metadata: { polaris-severity: Medium, category: correctness }
rule:
  any:
    - pattern: $T.skip($$)
    - pattern: $T.todo($$)
constraints:
  T: { regex: '^(it|test|describe|suite|context)
```

</details>
 }
---
id: js-recursive-delete
language: tsx
severity: hint
message: Recursive delete; check the path cannot be empty or user-controlled
metadata: { polaris-severity: Low, category: data-loss }
ignores: ["**/*.test.*", "**/*.spec.*", "**/test/**", "**/tests/**", "**/testing/**", "**/scripts/**"]
rule:
  any:
    - pattern: $FS.rmSync($P, $OPTS)
    - pattern: $FS.rm($P, $OPTS)
    - pattern: rmSync($P, $OPTS)
    - pattern: rm($P, $OPTS)
constraints:
  OPTS: { regex: 'recursive:\s*true' }
---
id: js-ts-suppression
language: tsx
severity: hint
message: A type error is suppressed
metadata: { polaris-severity: Low, category: maintainability }
rule:
  kind: comment
  regex: '@ts-(ignore|nocheck)'
---
id: js-debugger
language: tsx
severity: warning
message: A debugger statement was left in
metadata: { polaris-severity: Medium, category: correctness }
rule:
  kind: debugger_statement
---
# rules/python.yml
id: py-eval
language: python
severity: error
message: eval/exec runs a string as code
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - pattern: eval($$)
    - pattern: exec($$)
---
id: py-shell-true
language: python
severity: error
message: subprocess with shell=True passes the command through a shell
metadata: { polaris-severity: High, category: security }
rule:
  kind: call
  all:
    - has: { field: function, regex: '^subprocess\.' }
    - has:
        field: arguments
        has: { kind: keyword_argument, regex: '^shell\s*=\s*True
```

</details>
 }
---
id: py-os-system
language: python
severity: warning
message: os.system runs its argument through a shell
metadata: { polaris-severity: High, category: security }
rule:
  any:
    - pattern: os.system($$)
    - pattern: os.popen($$)
---
id: py-unsafe-deserialization
language: python
severity: error
message: Deserialising untrusted data can execute code
metadata: { polaris-severity: Critical, category: security }
rule:
  any:
    - pattern: pickle.loads($$)
    - pattern: pickle.load($$)
    - pattern: yaml.load($X)
    - pattern: yaml.unsafe_load($$)
    - pattern: marshal.loads($$)
---
id: py-tls-verification-off
language: python
severity: error
message: TLS certificate verification is turned off
metadata: { polaris-severity: Critical, category: security }
rule:
  kind: keyword_argument
  regex: '^verify\s*=\s*False
```

</details>

---
id: py-sql-format
language: python
severity: error
message: SQL built with string formatting can be injected
metadata: { polaris-severity: Critical, category: security }
rule:
  kind: call
  all:
    - has: { field: function, regex: '\.execute(many)?
```

</details>
 }
    - has:
        field: arguments
        has:
          nthChild: 1
          any:
            - { kind: string, has: { kind: interpolation } }
            - { kind: binary_operator }
            - { kind: call, has: { field: function, regex: '\.format
```

</details>
 } }
---
id: py-weak-hash
language: python
severity: warning
message: MD5 and SHA-1 are broken for security uses
metadata: { polaris-severity: Medium, category: security }
rule:
  any:
    - pattern: hashlib.md5($$)
    - pattern: hashlib.sha1($$)
  not: { regex: 'usedforsecurity\s*=\s*False' }
---
id: py-bare-except
language: python
severity: hint
message: A bare except swallows every error, including KeyboardInterrupt
metadata: { polaris-severity: Low, category: correctness }
rule:
  kind: except_clause
  regex: '^except\s*:'
---
# rules/go-rust-bash.yml
id: go-tls-verification-off
language: go
severity: error
message: TLS certificate verification is turned off
metadata: { polaris-severity: Critical, category: security }
rule:
  kind: keyed_element
  regex: '^InsecureSkipVerify:\s*true
```

</details>

---
id: go-shell-command
language: go
severity: warning
message: A command run through sh -c can be injected
metadata: { polaris-severity: High, category: security }
rule:
  pattern: exec.Command($SH, "-c", $$)
---
id: go-sql-sprintf
language: go
severity: error
message: SQL built with fmt.Sprintf can be injected
metadata: { polaris-severity: Critical, category: security }
rule:
  kind: call_expression
  all:
    - has: { field: function, regex: '\.(Query|QueryRow|Exec|QueryContext|ExecContext|QueryRowContext)
```

</details>
 }
    - has: { field: arguments, has: { kind: call_expression, regex: '^fmt\.Sprintf\(' } }
---
id: rust-tls-verification-off
language: rust
severity: error
message: TLS certificate verification is turned off
metadata: { polaris-severity: Critical, category: security }
rule:
  pattern: $B.danger_accept_invalid_certs(true)
---
id: rust-unsafe-block
language: rust
severity: hint
message: An unsafe block needs a SAFETY comment and a careful read
metadata: { polaris-severity: Medium, category: security }
rule:
  kind: unsafe_block
  not:
    any:
      - follows: { kind: line_comment, regex: 'SAFETY' }
      - inside:
          any: [{ kind: expression_statement }, { kind: let_declaration }]
          follows: { kind: line_comment, regex: 'SAFETY' }
---
id: sh-curl-pipe-shell
language: bash
severity: error
message: A downloaded script is piped straight into a shell
metadata: { polaris-severity: High, category: security }
rule:
  kind: pipeline
  all:
    - has: { kind: command, regex: '^(curl|wget)\b' }
    - has: { kind: command, regex: '^(sudo\s+)?(sh|bash|zsh)\b' }
---
id: sh-rm-rf-variable
language: bash
severity: error
message: rm -rf on a variable path deletes the wrong tree when the variable is empty
metadata: { polaris-severity: Critical, category: data-loss }
rule:
  kind: command
  regex: '^rm\s+-(rf|fr|r\s+-f)\s+["'']?\$\{?\w+\}?["'']?/?(\s|$)'
```

</details>

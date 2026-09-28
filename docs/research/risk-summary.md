# Research: building blocks for Risk Summaries

Linear: ENG-186. Researched 2026-09-27 against primary sources (vendor docs, source repos, specs). Every claim links to its source. Where a vendor makes a claim about itself, that is noted.

Context: the Review view shows a **Risk Summary** for a pull request or an Agent Session's changes. It is a ranked list of risky areas, each linked into the diff. It is built in three layers: (1) deterministic rules, (2) classification with TypeSafe AI's Jev, (3) agent-written summaries that use per-repo memories and learn from dismissed risks. It runs on the Host's Daemon (Bun/TypeScript; macOS arm64, Linux x64, Linux arm64 including a Raspberry Pi 4) inside the Review Checkout.

## TL;DR

- **Jev is real and well documented.** TypeSafe AI released Jev on 2026-09-15. It is a hosted, non-generative "System One" classifier. You send `state` plus typed questions (`choice`, `score`, `noul`) and get back typed answers with probabilities and a confidence value. It has an MIT-licensed TypeScript SDK (`@typesafe-ai/sdk`), costs $0.042 per million input tokens with free output tokens, and TypeSafe claims 70–500 ms latency. It is hosted only: no weights and no local mode. It has **no built-in code-quality categories**. Categories like "unnecessary comment" or "unmaintainable code" are questions that Polaris writes itself.
- **Jev works best on narrow, literal questions.** TypeSafe's own "jaggedness" page warns that the model reads questions literally, handles large distracting state poorly, and can be moved by adversarial content. A third-party fork reports that generic quality questions about a bare diff could not tell a bug from its fix, while pointed questions about a written rule could. So Layer 2 should ask one specific question per hunk per rule, not "is this code bad?".
- **Secrets: use Betterleaks, with TruffleHog as an optional second opinion.** Gitleaks is now "feature complete" and gets security patches only; its authors moved to Betterleaks (MIT). Both ship linux/darwin arm64 binaries and SARIF/JSON output. Both can scan a commit range via `git --log-opts` or stdin. TruffleHog is AGPL-3.0. It can verify live credentials, but verification calls third-party APIs with the found secret.
- **Pattern rules: ast-grep, not Semgrep's registry rules.** The Semgrep engine is LGPL-2.1, but the `semgrep-rules` corpus is under the Semgrep Rules License. That licence allows "internal business purposes" only and forbids distributing the rules or offering them as a service, so Polaris cannot bundle them. ast-grep is MIT, has a `@ast-grep/napi` binding with linux-arm64 builds (so it can run in-process in Bun), and emits JSON/SARIF. Semgrep or Opengrep is still worth adding as an optional scanner (Semgrep's `--baseline-commit` gives diff-only results), with rules the user supplies.
- **Every agent reviewer converges on the same finding shape:** severity (P0–P3, or Important/Nit/Pre-existing), a file and line range, a short reason, and sometimes a confidence value. Codex publishes its exact JSON schema. Claude Code Review adds a "pre-existing" severity and a verification pass before posting.
- **Learning from feedback comes in three styles.** (a) Embedding similarity against past 👎 votes (Greptile: blocked when similar to ≥3 downvoted comments). (b) Candidate rules promoted or demoted by accumulated signal (Cursor Bugbot learned rules). (c) Chat-created "learnings" with an optional approval delay (CodeRabbit). Claude Code Review and Codex do **not** self-modify per repo. They read checked-in instruction files (`REVIEW.md`/`CLAUDE.md`, `AGENTS.md`), and Anthropic uses 👍/👎 counts only to tune the global reviewer.
- **Public false-positive numbers are vendor-reported and not comparable.** Examples: Claude Code Review "<1% of findings marked incorrect", Bugbot 78% resolution rate (graded by an LLM judge), Greptile address rate rising from 19% to 55%+ after the embedding filter, and Graphite claims of both "<3%" and "5–8%" false positives. Polaris should measure its own dismissal rate per layer.
- **Recommendation:** a single SARIF-inspired `RiskFinding` record for all three layers, with a stable fingerprint and an explicit `status`. Dismissals are recorded with a reason. Learning produces *proposed* memories that a human approves before they apply. Memories are stored as a diffable, versioned file with scope globs and provenance. Deterministic secret findings can never be suppressed by learned memories.

---

## 1. Deterministic layer: secret and pattern scanners

### Summary table

| Tool | Licence | Diff-only mode | arm64 (macOS / Linux / Pi) | Output | Notes |
|---|---|---|---|---|---|
| Gitleaks v8.30.1 | MIT | `gitleaks git --log-opts="A..B"`; `stdin` | darwin_arm64, linux_arm64, linux_armv7 binaries | json, csv, junit, sarif, template | Maintenance mode: "feature complete… security patches only" |
| Betterleaks v1.8.1 | MIT | `git`, `dir`, `stdin` sources; `log-opts` in source | darwin_arm64, linux_arm64 binaries | SARIF (in source), JSON | Successor to Gitleaks by the same authors |
| TruffleHog v3.97.9 | AGPL-3.0 | `git file://. --since-commit main --branch HEAD` | darwin_arm64, linux_arm64 binaries | JSON, SARIF | 700+ detectors that verify live credentials |
| Semgrep CE v1.178.0 | Engine LGPL-2.1; registry rules under Semgrep Rules License | `--baseline-commit <sha>` | PyPI wheels for macOS arm64, manylinux_2_34 aarch64, musllinux aarch64 | `--json`, `--sarif` | Inter-file analysis needs the Pro engine |
| Opengrep v1.30.0 | LGPL-2.1 | (Semgrep fork) | standalone manylinux/musllinux aarch64 and osx aarch64 binaries | (Semgrep-compatible) | Its rules fork carries a "Commons Clause" (no selling) |
| ast-grep 0.45.3 | MIT | none built in; pass changed files | aarch64 darwin/linux zips; `@ast-grep/napi` linux-arm64-gnu/musl, darwin-arm64 | `--json`, `--format` (GitHub, SARIF) | Can run in-process in Bun via napi |

Sources: releases and licences from the GitHub API for [gitleaks](https://github.com/gitleaks/gitleaks/releases/latest), [betterleaks](https://github.com/betterleaks/betterleaks/releases/latest), [trufflehog](https://github.com/trufflesecurity/trufflehog/releases/latest), [semgrep](https://github.com/semgrep/semgrep), [opengrep](https://github.com/opengrep/opengrep/releases/latest), [ast-grep](https://github.com/ast-grep/ast-grep/releases/latest). Semgrep wheels from [PyPI](https://pypi.org/project/semgrep/#files). ast-grep napi platforms from the [npm registry](https://www.npmjs.com/package/@ast-grep/napi).

### Secret scanning

- **Gitleaks** has three scan modes: `git`, `dir` and `stdin`. `git` mode wraps `git log -p`, which you shape with `--log-opts` (for example `--log-opts="--all commitA..commitB"`). Report formats are json, csv, junit, sarif and template ([README](https://github.com/gitleaks/gitleaks#readme)). The README now says: "Gitleaks is feature complete. I'm not merging new features into Gitleaks. Future releases will be security patches only. I'm shifting my focus to Betterleaks" ([README](https://github.com/gitleaks/gitleaks#readme)).
- **Betterleaks** is "maintained by the folks who made Gitleaks, including the original author". It adds Expr-based rule filters that can use git attributes such as author and path, optional in-rule validation of secrets over HTTP, and "token efficiency" filtering with BPE tokenisation to cut natural-language false positives ([README](https://github.com/betterleaks/betterleaks#readme)). SARIF output and `log-opts` exist in its source ([report/sarif.go](https://github.com/betterleaks/betterleaks/blob/main/report/sarif.go), [cmd/git.go](https://github.com/betterleaks/betterleaks/blob/main/cmd/git.go)). It accepts CEL-shaped configs for compatibility ([README](https://github.com/betterleaks/betterleaks#readme)); whether it reads a `.gitleaks.toml` unchanged was not verified.
- **TruffleHog** handles PR-scoped scans with `--since-commit main --branch <pr-branch>`, or `--branch HEAD` if the branch is already checked out. Its documented example is `trufflehog git file://. --since-commit main --branch feature-1 --results=verified,unknown --fail`. It outputs `--json` and `--sarif`; SARIF is buffered in memory for the whole scan. "Verified" means the credential was tested against the provider's API ([README](https://github.com/trufflesecurity/trufflehog#readme)). `--no-verification` turns this off ([README flags](https://github.com/trufflesecurity/trufflehog#readme)).
  - *Implication:* verification sends a candidate secret over the network to a third party. For a local-first Daemon, default to `--no-verification`, or make verification an explicit per-Workspace opt-in.
  - AGPL-3.0 ([repo](https://github.com/trufflesecurity/trufflehog)). Running the unmodified binary as a subprocess is the low-friction way to use it. Do not vendor or modify it without looking at the AGPL obligations.

### Pattern and dangerous-code rules

- **Semgrep CLI**: `--baseline-commit` means "only show results that are not found in this commit hash". It aborts if there are unstaged changes. `--json` and `--sarif` are available. `--config auto` logs in to the registry with your project URL and sends metrics. `--metrics` defaults to `auto`, which sends metrics whenever config is pulled from the Semgrep server. `--pro` (inter-file analysis) "requires Semgrep Pro Engine" ([CLI reference](https://docs.semgrep.dev/cli-reference)).
  - *Implication for a Review Checkout:* `--baseline-commit` refuses to run with unstaged changes. Diffs of uncommitted agent changes therefore need a scratch commit first, or a list of changed files instead.
- **Semgrep rules licence** (`semgrep/semgrep-rules` LICENSE: "Semgrep Rules License v1.0"): "You may use the rules only for your own internal business purposes. This license does not allow you to distribute the rules, or to make them available to others as a service." ([repo LICENSE](https://github.com/semgrep/semgrep-rules/blob/develop/LICENSE), [licence text](https://semgrep.dev/legal/rules-license)). **Polaris must not ship these rules.** A user may point Polaris at a rules path they fetched themselves.
- **Opengrep** is an LGPL-2.1 fork of Semgrep with standalone aarch64 binaries, so it needs no Python ([releases](https://github.com/opengrep/opengrep/releases/latest)). Its rules fork `opengrep/opengrep-rules` ("Fork of semgrep-rules (December 13, 2024)") carries a "Commons Clause" condition that withholds "the right to Sell the Software" ([LICENSE](https://github.com/opengrep/opengrep-rules/blob/main/LICENSE)). It is still not a clean corpus to bundle.
- **ast-grep**: MIT ([repo](https://github.com/ast-grep/ast-grep)). `sg scan` supports `--json[=pretty|stream|compact]` and `--format` for GitHub Actions and SARIF ([scan CLI reference](https://ast-grep.github.io/reference/cli/scan.html)). The `@ast-grep/napi` package has prebuilt `linux-arm64-gnu`, `linux-arm64-musl`, `darwin-arm64` and x64 binaries ([npm](https://registry.npmjs.org/@ast-grep/napi/latest)). This lets the Daemon run YAML rules in-process on only the changed files, with no subprocess. Polaris would write and own its rule pack (for example `eval`, `child_process.exec` with interpolation, disabled TLS verification, `dangerouslySetInnerHTML`, SQL built by string concatenation).

### arm64 and Raspberry Pi 4

- Every tool above publishes Linux aarch64 artefacts (table sources). The Pi 4 must run a **64-bit** OS to use them. Only Gitleaks also ships `linux_armv6`/`armv7` ([releases](https://github.com/gitleaks/gitleaks/releases/latest)).
- Semgrep's Linux arm64 wheel is tagged `manylinux_2_34_aarch64`, so it needs glibc ≥ 2.34 on the Host ([PEP 600](https://peps.python.org/pep-0600/), [PyPI files](https://pypi.org/project/semgrep/#files)). It also needs a Python runtime. Opengrep's static binaries avoid both.
- **Speed:** none of these projects publish benchmarks that compare on equal terms, and none of the tools were installed on the research machine. Speed on a Pi 4 is an open question (see below). Semgrep's default parallelism is 0.85 × logical cores ([CLI reference](https://docs.semgrep.dev/cli-reference)).

---

## 2. What "TypeSafe AI's Jev" is

**Identified with high confidence.** Jev is the flagship model of TypeSafe AI (typesafe.ai). TypeSafe released it in early access on **2026-09-15** as "the first System One model" ([TypeSafe blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [docs intro](https://docs.typesafe.ai/introduction)).

### What it is

- It is a non-generative decision model: "It does not generate text, write code, or hold a conversation. It takes a state and a set of typed questions and returns structured answers" ([Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)). It is "**not** a drop-in replacement for the LLM behind Claude Code, Cursor…" (same page).
- It has three primitives ([API reference](https://docs.typesafe.ai/api)):
  - `noul`: a yes/no question that returns a probability of yes (0–1). Nouls carry no `confidence` value.
  - `choice`: picks from up to **255** options you define. Returns `choice`, per-option `probabilities` and `confidence`.
  - `score`: rates on an ordered rubric of 2–10 levels. Returns a probability-weighted `score`, `legend`, `probabilities` and `confidence`.
- **Categories:** there are no built-in code categories. You write the rubric: "Encode your domain rules and boundary cases in the `instructions` and `criteria` of each question" ([Models: Customizing Jev](https://docs.typesafe.ai/models)). "Unnecessary comments" and "unmaintainable code" are therefore Polaris-authored questions, not a Jev feature.
- It cannot be fine-tuned per customer: "Jev is not fine-tuned or LoRA-adapted with customer data… the same weights serve every account" ([Models](https://docs.typesafe.ai/models)).

### How it is invoked

- HTTP: `POST https://api.typesafe.ai/v1/systemone` with a Bearer key, `model` (`jev-latest`, or the pinned `jev-1.13.0`), `state` (string, object or array) and a `questions` map ([API reference](https://docs.typesafe.ai/api)).
- SDKs: JavaScript/TypeScript `@typesafe-ai/sdk` (Node ≥ 20, answer types inferred from questions) ([JS SDK](https://docs.typesafe.ai/sdk/javascript)). The SDK repo is MIT, v0.6.0 ([GitHub](https://github.com/typesafe-ai/typesafe-sdk-js), [npm](https://registry.npmjs.org/@typesafe-ai/sdk/latest)). There is also a Python SDK ([docs](https://docs.typesafe.ai/sdk/python)).
- An agent skill is available for Claude Code and Codex ([agent skill](https://docs.typesafe.ai/agent-skill)), plus a Playground at console.typesafe.ai ([coding agents page](https://docs.typesafe.ai/introduction/coding-agents)).
- **Bun compatibility of the SDK was not verified.** The SDK targets Node ≥ 20. A plain `fetch` to the HTTP endpoint is a trivial fallback.

### Pricing, limits, latency, hosting

- Price: $42 per billion ($0.042 per million) input tokens; output tokens are free ([Models](https://docs.typesafe.ai/models)).
- Rate limits: 250,000 tokens/s and 1,200 requests/min. TypeSafe says these "are adjusting dynamically… can change without notice" ([Models](https://docs.typesafe.ai/models)).
- Context: 64k tokens per request; 32k for `state` plus the longest question. Text only ([Models](https://docs.typesafe.ai/models)).
- Latency: TypeSafe claims "70ms–500ms" end to end and "193.6x faster, 444.6x cheaper" in its own workflow evaluations. The blog itself calls the 193.6x figure the "higher end of real world gains" ([blog](https://typesafe.ai/blog/introducing-system-one-models-and-jev)). These are vendor claims and have not been measured here.
- Hosting: hosted API only. Nothing in the docs mentions weights, self-hosting or on-device use. TypeSafe does not train on customer requests. Zero data retention (ZDR) is offered to enterprise customers ([Models: Data handling](https://docs.typesafe.ai/models), [Legal](https://docs.typesafe.ai/legal)).
- Model licence: proprietary service under the Master Customer Agreement ([Legal](https://docs.typesafe.ai/legal)). Only the SDKs are open source (MIT).

### Known weaknesses that matter for code review ([Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13))

- "Literal reading: answers the question you wrote, not the one you meant."
- Counting and numbers are unreliable ("Jev is not a calculator"), so cyclomatic-complexity or line-length thresholds should stay in code.
- "Accuracy falls as the state grows with content unrelated to the decision", so send the hunk plus minimal context, not the whole file.
- "Adversarial content… can move the answer". The diff is attacker-controllable text, including agent-written text, so Jev output must never *suppress* a Layer 1 finding.
- The page says Jev "performs better on high-level programming languages than… low level assembly."
- Confidence thresholds "scale with risk". Pin a model version if you tune thresholds, because the `jev-latest` alias moves ([Confidence](https://docs.typesafe.ai/confidence), [Models: Aliases](https://docs.typesafe.ai/models)).

### Third-party evidence (not first-party, weight accordingly)

- `robrichardson13/jev-review` (MIT, created 2026-09-17, 0 stars) is a local MCP server that uses Jev for quality scores. Its README notes: "generic quality questions about a bare diff could not tell a bug from its fix, while a pointed question about a rule that is written down separated the same pairs cleanly (bug 0.72–0.95, fix 0.05–0.09)" ([README](https://github.com/robrichardson13/jev-review)). This is a single author's unreplicated measurement, but it matches TypeSafe's own "literal reading" guidance.

---

## 3. Agent-review layer: how products structure findings and learn

### Finding structure

| Product | Severity scale | Location | Other fields | Source |
|---|---|---|---|---|
| Codex `/review` | P0–P3 in the title, plus numeric `priority` 0–3 | `code_location.absolute_file_path`, `line_range{start,end}`; must overlap the diff; 5–10 lines max | `title` (≤80 chars), `body`, `confidence_score` 0–1; `overall_correctness`, `overall_explanation`, `overall_confidence_score` | [rubric.md](https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/review/rubric.md) (Apache-2.0) |
| Codex on GitHub | Posts only P0 and P1 | inline | — | [Use Codex in GitHub](https://learn.chatgpt.com/docs/third-party/github) |
| Claude Code Review | 🔴 Important, 🟡 Nit, 🟣 Pre-existing | inline plus check-run annotations | extended-reasoning section; machine-readable counts `{"normal","nit","pre_existing"}`; check run is always neutral | [Code Review docs](https://code.claude.com/docs/en/code-review) |
| Greptile | P0 Critical, P1 High, P2 Medium; comment types `logic`/`syntax`/`style` | inline | PR "confidence score" 0–5; strictness 1–3 | [Anatomy of a review](https://www.greptile.com/docs/code-review/first-pr-review), [Nitpickiness](https://www.greptile.com/docs/code-review/controlling-nitpickiness) |
| Cursor Bugbot | `severity` (high/medium/…) | `locations` | `resolution_status` (resolved/unresolved) per finding via API; `dry_run` mode | [Bugbot docs](https://cursor.com/docs/bugbot) |

Design notes from these products:

- Codex's rubric only flags an issue if it was "introduced in the commit (pre-existing bugs should not be flagged)". The issue must also be "discrete and actionable", and the reviewer must "identify the other parts of the code that are provably affected" rather than speculate ([rubric.md](https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/review/rubric.md)). For rules from `AGENTS.md`, Codex must cite "the applicable project instruction file that supplies the rule and its smallest supporting line range" (same file). Polaris could copy this rule attribution directly.
- Claude Code Review runs parallel agents that each look for "a different class of issue", then "a verification step checks candidates against actual code behavior to filter out false positives", then results are deduplicated and ranked by severity ([docs](https://code.claude.com/docs/en/code-review)). It averages 20 minutes and $15–25 per review (same page), so it is not a model for an interactive Risk Summary's latency.

### Learning from feedback

- **CodeRabbit Learnings.** CodeRabbit creates a learning from a chat reply when it judges the reply to be a team-wide preference rather than a one-off. You can also import one from a file (`@coderabbitai add a learning using docs/coding-standards.md`). Learnings are stored in an org-linked database with credentials redacted, and scoped `auto`/`global`/`local`. They are viewable and editable in a dashboard with usage count and last-used date. `approval_delay: N` holds new learnings for N days before they apply. Learnings from an open PR apply only to that PR until merge. Path instructions take precedence over learnings, and CodeRabbit auto-detects `.cursorrules`, `CLAUDE.md` and `.github/copilot-instructions.md` ([Learnings docs](https://docs.coderabbit.ai/guides/learnings)).
- **Greptile.** It learns from 👍/👎 (other emoji are neutral), from replies, from team comments, and from whether comments were addressed between the first and last commit. Its docs say security issues are "always flagged" and logic errors "never suppressed" ([Memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning), [Training](https://www.greptile.com/docs/code-review/training-the-learning-system), [Reducing nitpicks](https://www.greptile.com/docs/how-greptile-works/nitpicks)). The mechanism is described in its blog: a new comment is blocked if its embedding's cosine similarity passes a threshold against ≥3 distinct downvoted comments, and passes if similar to ≥3 upvoted ones. Filtering is per team. Prompting "could not get the LLM to produce fewer nits without also producing fewer critical comments", and LLM-as-judge self-filtering "was nearly random" ([How to make LLMs shut up](https://www.greptile.com/blog/make-llms-shut-up)).
- **Cursor Bugbot learned rules.** Its signals are downvotes, replies explaining what was wrong, and human reviewer comments on issues Bugbot missed. These become candidate rules that "it continues to evaluate against incoming PRs. As signal accumulates, Bugbot can promote a candidate rule to active… [if] an active rule starts generating consistent negative signal, Bugbot can disable it" ([blog](https://cursor.com/blog/bugbot-learning)). Rules have a name, content and optional **scoped path globs**. `@cursor remember [fact]` adds a rule. Per-rule analytics show issues found, PRs reviewed, accepted issues and acceptance rate. `bugbot run verbose=true` lists every rule a review used. Rule order is Team Rules → `.cursor/BUGBOT.md` (root plus nested, walked upward from changed files) → learned → manual, capped at 30k characters per rule and 100k in total ([Bugbot docs](https://cursor.com/docs/bugbot)). Promotion is automatic; human review is edit or delete after the fact.
- **Graphite (Diamond, now "Graphite Agent").** It uses custom prompt rules, file-based rules that reference repo docs by glob, and comment exclusions. It tracks upvote and downvote rates per rule ([Customization](https://graphite.com/docs/ai-review-customization)). The customization docs do not describe automatic learning.
- **Claude Code Review.** It has no per-repo self-modification. Repos steer it with `CLAUDE.md` (new violations become nits, and it flags a `CLAUDE.md` that the PR makes stale) and `REVIEW.md` (severity recalibration, nit caps, verification bar, re-review convergence). 👍/👎 are pre-attached. "Anthropic collects reaction counts after the PR merges and uses them to tune the reviewer. Reactions do not trigger a re-review or change anything on the PR" ([docs](https://code.claude.com/docs/en/code-review)).
- **Codex.** It has no per-repo learning. Rules go in a `## Code Review Rules` section of the nearest `AGENTS.md` ([Use Codex in GitHub](https://learn.chatgpt.com/docs/third-party/github)). `AGENTS.override.md` takes precedence over `AGENTS.md` ([rubric.md](https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/review/rubric.md)).

### How products avoid drift from self-modification

Only as documented. None of these products publish a full drift policy.

- **Human-editable, inspectable memory:** CodeRabbit's dashboard with usage stats, and Bugbot's rules UI, per-rule analytics and `verbose=true` rule table ([CodeRabbit](https://docs.coderabbit.ai/guides/learnings), [Bugbot](https://cursor.com/docs/bugbot)).
- **Delay or quarantine before a learning applies:** CodeRabbit's `approval_delay`, and PR-scoped learnings until merge ([CodeRabbit](https://docs.coderabbit.ai/guides/learnings)).
- **Evidence thresholds instead of single events:** Greptile needs ≥3 similar downvotes ([blog](https://www.greptile.com/blog/make-llms-shut-up)). Bugbot promotes candidates as signal accumulates and auto-disables rules on consistent negative signal ([blog](https://cursor.com/blog/bugbot-learning)).
- **Categories that can never be suppressed:** Greptile's docs say security is always flagged and logic errors are never suppressed ([Memory and learning](https://www.greptile.com/docs/how-greptile-works/memory-and-learning)).
- **Checked-in, reviewable instructions instead of learned state:** Claude Code (`REVIEW.md`/`CLAUDE.md`) and Codex (`AGENTS.md`) ([Claude](https://code.claude.com/docs/en/code-review), [Codex](https://learn.chatgpt.com/docs/third-party/github)).
- **Scope limits:** CodeRabbit's local/global scope and Bugbot's path globs ([CodeRabbit](https://docs.coderabbit.ai/guides/learnings), [Bugbot](https://cursor.com/docs/bugbot)).

### What is documented about false-positive rates

All figures below are vendor self-reports, with differing or undefined methodology:

- Claude Code Review: "less than 1% of findings are marked incorrect". On PRs over 1,000 lines, 84% get findings (average 7.5); on PRs under 50 lines, 31% (average 0.5). Internal testing ([Claude blog](https://claude.com/blog/code-review)).
- Cursor Bugbot: 78.13% resolution rate across 50,310 PRs, up from 52% at GA. "Resolution" is judged by an LLM checking whether each comment was addressed before merge ([blog](https://cursor.com/blog/bugbot-learning)).
- Greptile: address rate rose from 19% to "55+%" within two weeks of the embedding filter ([blog](https://www.greptile.com/blog/make-llms-shut-up)).
- Graphite: "<3% false-positive rate across tens of thousands of code changes" ([launch blog](https://graphite.com/blog/graphite-reviewer-launch)); "often closer to 5–8%" ([guide](https://graphite.com/guides/ai-code-review-false-positives)); "Less than 5% negative comment rate" ([features page](https://graphite.com/features/ai-reviews)). These are three different numbers from one vendor.
- The Anthropic security-review GitHub Action (MIT) has a separate false-positive filtering stage with custom filtering instructions (`false-positive-filtering-instructions`) but publishes no rate ([repo](https://github.com/anthropics/claude-code-security-review)).

Takeaway: "addressed or resolved before merge" is the metric the industry actually measures. Polaris gets the equivalent for free as its dismissal and fix rate per layer, per rule and per memory.

---

## 4. Recommendation

### 4a. Finding schema

One record for every layer. Field names follow SARIF where there is an equivalent, so SARIF from Betterleaks, TruffleHog, Semgrep and ast-grep maps in directly. SARIF has `result.level`, `partialFingerprints`, and `suppression` with `kind` (`inSource`/`external`) and `status` (`accepted`/`underReview`/`rejected`) plus `justification` ([SARIF 2.1.0 §3.27, §3.35](https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/sarif-v2.1.0-errata01-os-complete.html)).

```ts
type RiskFinding = {
  id: string;                       // uuid
  fingerprint: string;              // stable across re-runs/rebases: hash(source.ruleId, path, normalized matched text) — SARIF partialFingerprints-style
  source: {
    layer: "rule" | "classifier" | "agent";
    tool: string;                   // "betterleaks" | "ast-grep" | "jev" | "claude" | ...
    toolVersion: string;            // pin: e.g. "jev-1.13.0", never the moving alias
    ruleId: string;                 // scanner rule id, Jev question id, or agent check name
    memoryIds?: string[];           // Risk Memories that shaped this finding (Codex-style rule attribution)
  };
  severity: "P0" | "P1" | "P2" | "P3";  // P0 = block/secret; mirrors Codex/Greptile scales
  category: "secret" | "dangerous-pattern" | "correctness" | "security" | "maintainability" | "noise" | string;
  introduced: "this-change" | "pre-existing";  // Claude's 🟣 / Codex rule 4
  location: { path: string; startLine: number; endLine: number; side: "new" | "old"; commit: string };
  reason: string;                   // one paragraph, why it's risky (Codex rubric style)
  evidence?: { snippet: string; redacted: boolean };  // secrets always redacted
  confidence?: number;              // 0–1 (Jev confidence/noul, agent self-score); absent for deterministic rules
  status: "open" | "accepted" | "fixed" | "dismissed";
  dismissal?: {
    reason: "false-positive" | "acceptable-risk" | "wont-fix" | "not-relevant-here" | "duplicate";
    note?: string; by: string; at: string;
  };
};
```

Ranking: sort by `severity`, then `layer` (rule before classifier before agent, for the same severity), then `confidence`. Merge findings that share a fingerprint or overlapping location and category, and keep every `source`. This follows Codex's instruction to "deduplicate findings by changed location and defect/remedy" and to union rule support ([rubric.md](https://github.com/openai/codex/blob/main/codex-rs/prompts/templates/review/rubric.md)).

### 4b. Layer wiring on the Daemon

1. **Rules layer (always on, local, offline).** Betterleaks over the Review Checkout's commit range, or stdin for uncommitted Turn diffs. ast-grep via `@ast-grep/napi` in-process, with a Polaris-owned rule pack run on changed files only. Optional user-configured Semgrep or Opengrep with user-supplied rules (`--baseline-commit`), and optional TruffleHog with verification off by default.
2. **Classifier layer (opt-in per Workspace, because code leaves the Host).** Jev over hunks. Use one `noul` per (hunk, rule), with the rule phrased literally, for example: "Does the added comment only restate what the next line of code does?" Keep `state` small (hunk plus enclosing function). Pin `jev-1.13.0`. Threshold per rule by risk. Map to at most P2 unless the rule is explicitly marked higher. Batch all questions for a file into one call (fan-out pattern; [docs](https://docs.typesafe.ai/patterns/fan-out)).
3. **Agent layer.** It receives Layer 1 and 2 findings as input and writes the Risk Summary: ranked risky *areas* with a reason, linking back to findings. Give it Codex-style rubric rules (introduced-by-this-change only, provable impact, cite the rule source) and a verification pass like Claude's. It reads repo instruction files (`AGENTS.md`/`CLAUDE.md`/`REVIEW.md`) plus approved Risk Memories.

### 4c. Feedback and learning loop, with human approval gates

1. **Capture.** Every dismissal records `reason` and an optional note, keyed by fingerprint. A fixed finding (fingerprint gone after a later Turn) counts as a positive signal. Greptile compares first and last commit in the same way ([nitpicks](https://www.greptile.com/docs/how-greptile-works/nitpicks)).
2. **Immediate, narrow effect (no approval needed).** A dismissed fingerprint stays dismissed for that Review. This is SARIF `suppression.kind = "external"`.
3. **Propose, don't apply.** When similar dismissals cross a threshold (for example ≥3 similar dismissals in the same repo, following Greptile's ≥3 rule), the agent drafts a **Risk Memory**. A Risk Memory has a name, instruction text, scope globs (as in Bugbot), the evidence (linked dismissals) and the target layer. For example, it might lower a rule's severity, add a Jev question exclusion, or add an instruction for the agent layer. It appears in the Review UI as *proposed*.
4. **Human approval gate.** A proposed memory has no effect until the user approves it. CodeRabbit's `approval_delay` is the softer precedent. For a single-user tool, explicit approval is cheap and avoids silent drift.
5. **Storage.** Approved memories go in a diffable, versioned file in the repo (for example a Polaris section of `REVIEW.md`/`AGENTS.md`, or `.polaris/risk-memories.md`), so git history is the audit log. Whether to commit it or keep it in Polaris state is an open question below.
6. **Guardrails against drift:**
   - Memories can never suppress `layer: "rule"` findings in `category: "secret"`, or any P0. Greptile has a similar "never suppressed" class.
   - Every finding lists the `memoryIds` that shaped it, and the Review shows them. This mirrors Bugbot's `verbose=true` and Codex's rule attribution.
   - Per-memory stats (times applied, findings suppressed, later-reverted outcomes) follow CodeRabbit's usage count and Bugbot's acceptance rate. When a memory's effect is contradicted, for example a suppressed class later causes a revert or fix, the agent proposes **disabling** it, and that also needs approval.
   - A small replay set of past *accepted* findings is re-run whenever memories change. If a memory would hide a previously accepted finding, the proposal is flagged.
   - Memories expire or need re-confirmation after N months, or when the model or tool version changes (the Jev alias moves; [Models](https://docs.typesafe.ai/models)).

---

## Open questions

1. **Is sending diffs to TypeSafe acceptable?** Jev is hosted only (no ZDR below enterprise), which conflicts with a local-first, Pi-capable Daemon. Layer 2 needs an offline fallback, such as an LLM or no classifier.
2. **Jev access and quality on code.** Can a personal account get a key today (early access)? What are the real latency and cost for about 200 hunks × 5 questions? How well does it do on the user's own examples of "unnecessary comments" and "unmaintainable code"? No first-party code-review evaluation exists.
3. **Scanner speed on a Pi 4.** Benchmark Betterleaks, ast-grep napi and Opengrep on a real PR range. No primary benchmarks exist.
4. **Where Risk Memories live.** Should they be committed in the repo (shared and reviewable, but they touch the user's repo) or kept in Daemon state per Workspace (private, but invisible to git)?
5. **Betterleaks and Gitleaks config compatibility** (`.gitleaks.toml`, `gitleaks:allow` comments) was not verified.
6. **Is `@typesafe-ai/sdk` compatible with Bun?** It targets Node ≥ 20. Raw `fetch` is the fallback.
7. If Polaris is ever distributed, re-check every rule-pack licence. Semgrep and Opengrep rule corpora cannot be bundled.

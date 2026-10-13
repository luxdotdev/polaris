---
status: accepted
implements: the Classifier layer of the Risk Summary (owner decisions, 2026-10-13; Linear M6)
---

# The Classifier asks pointed questions, adds and raises Findings, never lowers them

A Risk Summary has three sources: rules, the Classifier, and the Reviewer.
Rules and the Reviewer ship; the Classifier was left for M6, and
`FindingSource` already lists `"classifier"` so its Findings decode on older
builds. Research ([risk-summary.md](../research/risk-summary.md),
[decision-models.md](../research/decision-models.md)) found one wire shape
(`POST /v1/systemone`) served by Jev, Clef on Cloudflare Workers AI, Kev and
llama.cpp, and no evidence that any of them can tell whether a hunk is risky
from a generic question. They answer narrow, written questions well, the diff
is attacker-controlled, and prompt injection can move an answer.

"Classifier" is the glossary term and means the same thing as a decision
model in OpenAI's sense
([decisions guide](https://developers.openai.com/api/docs/guides/decisions)).
The service it calls is a Classifier Backend. "Decision model" and "System
One" never appear in UI copy. The owner settled the design on 2026-10-13; the
numbers below (Q1 to Q20) are the questions it answered and are what tickets
cite.

## Decision

### What it does

1. **Two jobs (Q1).** The Classifier writes its own Findings, one pointed
   question per hunk per written rule, and annotates the Reviewer's
   Findings. Routing hunks to the Reviewer is left for later.
   Maintainability gets serious attention: unnecessary or over-long
   comments, over-nested functions, and similar.
2. **It only adds and raises (Q2, Q9).** It never hides, lowers or demotes a
   Finding from any source, Rule, Agent or Critical. It may annotate a
   Reviewer Finding (confidence, introduced vs pre-existing, matches a past
   thumbs-down) and may promote one (higher ranking or Severity). Every
   effect cites the question that caused it.
3. **Severity is declared by the question (Q12).** Built-in maintainability
   questions are capped at Low or Medium. Questions from repo rules and Risk
   Memories may declare High. A Classifier Finding is never Critical.
4. **Numbers are measured, judgement is asked (Q10).** Counting stays
   deterministic in the rules layer; the Classifier judges. A rule can hand
   it context, such as "nesting went 3 → 6; is it essential?". Polaris's own
   oxlint and SonarJS rules apply only to this repository and don't ship, so
   users' code needs Polaris to measure it.
5. **Structural metrics (Q15).** One deterministic metrics module in the
   Daemon, on the ast-grep parsing the rules layer already does, with pinned
   grammar versions and golden-file tests per language (TSX, Python, Go,
   Rust, Bash). Per changed function it measures nesting depth, length,
   parameter count and cognitive complexity. The rules layer reports only
   regressions the change caused. Thresholds are defaults a repository can
   override. The same module is the CLI `polaris metrics <file> [--lines a-b]`
   (JSON), which the Reviewer may run as a read-only tool.

### Where questions come from

6. **Three sources, each cited (Q6).** A built-in pack; the repository's
   written rules (REVIEW.md, AGENTS.md, CLAUDE.md); and approved Risk
   Memories compiled into questions. Every question carries its source.
7. **A question ships only after the lab passes it (Q8, Q11, Q16).** The
   question lab is a CLI that runs a question pack against labelled hunks on
   each Classifier Backend and reports precision and recall per question. A
   question ships only after clearing a bar on a pinned backend model
   version, never a moving alias. Each question's thumbs-down rate is
   tracked, and a noisy question can be switched off. Labelled hunks come
   from Polaris's own history, from permissively licensed open-source fix
   commits in the five languages (hunks stored, commits pinned, never GPL or
   AGPL), and from the user's own Verdicts (opt-in, kept local).
8. **Risk Memory questions are approved with the memory (Q20).** The Reviewer
   drafts the question from the Verdict and its code, the question lab checks
   the draft on that repository's labelled hunks, and the user approves the
   question text and the Risk Memory in one step.

### Where it runs and what it calls

9. **On the Host (Q4).** The Classifier runs in the Host's Daemon, next to
   the Review Checkout. A Host without egress shows the layer as unavailable
   instead of failing the Risk Summary.
10. **Off until chosen (Q5).** There is no Classifier until a Classifier
    Backend is chosen in Settings. Then it is on for every repository, with a
    per-repository opt-out. A self-hosted backend counts as local.
11. **Three backends in v1, one interface (Q7, Q13).** Jev (TypeSafe,
    hosted), Cloudflare Workers AI (Clef and Clef-flash, which has a free
    tier), and any self-hosted `/v1/systemone` server (Kev, llama.cpp). Polaris
    owns a thin `fetch` client behind one `Classifier` service
    (`Context.Service`), with Effect Schema parsing at the boundary; each
    backend is a Layer, so Effect consumers see one stable API and tests swap
    the backend.
12. **One request per hunk (Q14).** A request carries all of a hunk's
    questions (Clef takes at most 64). Answers are cached by hunk hash,
    question and pinned model. Each backend has a daily budget, shown in
    Settings → Usage; when it runs out the layer reads "paused until
    tomorrow".
13. **A self-hosted backend lives on one named Host (Q18).** Other Hosts reach
    it through the existing SSH connection, using the placement model tab
    completion already has, never through a public port.

### Credentials

14. **Kept by the Client, lent per review (Q17).** Backend credentials live
    in the client OS's secure store and go to the Daemon with each review
    over the existing SSH connection. The Host holds them in memory only.
    With no Desktop App connected, the layer is skipped and says so.
15. **One `SecureStorage` service (Q17).** Windows support means this can't
    be macOS-only. The GitHub client's `safeStorage` keychain
    (`apps/desktop/src/main/github/electron.ts`) moves into a shared
    `SecureStorage` service (`Context.Service`) with one API: get, set and
    delete by namespaced key. Its Layers are Electron `safeStorage` (Keychain
    on macOS, DPAPI on Windows, libsecret on Linux, refusing when Linux falls
    back to `basic_text`) and in-memory for tests. GitHub moves onto it.

### Ship order (Q19)

1. The `Classifier` interface, the three backends, the question lab CLI and
   about five built-in maintainability questions. Nothing user-visible.
2. Structural metrics and `polaris metrics`.
3. The Classifier layer in the Risk Summary, backend choice in Settings, the
   budget in Usage. Needs slice 1 and `SecureStorage`.
4. Repo rules and Risk Memories compiled into questions, and promotion of
   Reviewer Findings.

## Consequences

- An injected or wrong answer can add noise or raise a Finding, but it can't
  make a real problem disappear. The cost is false positives, which the
  question lab and per-question thumbs-down rates exist to keep down.
- Every Classifier effect is traceable to a question and its source, so a
  noisy question is switched off rather than the whole layer.
- A model change at a backend doesn't silently change answers: pins and the
  cache key include the model version, and moving a pin means rerunning the
  lab.
- The Daemon gains a metrics module and a CLI subcommand on grammars it
  already ships; per-language golden files guard grammar upgrades.
- Credentials never rest on a Host. A Host reviewed with no Desktop App
  connected (a headless run, or the Mobile App later) gets no Classifier
  layer until a Client can lend one.
- `SecureStorage` must work on Windows and Linux before slice 3 ships, and
  the GitHub client changes storage without users signing in again.
- Users with no backend see nothing new; the Risk Summary is unchanged for
  them.

## Alternatives rejected

- **The AI SDK's `experimental_decide`.** It was renamed within a month of
  shipping. Our own client is small and the wire shape is shared; revisit
  once the SDK's API is stable.
- **Letting the Classifier demote or dismiss Findings.** The diff is
  attacker-controlled and injection can move answers, so a Classifier that
  can clear a Finding is a way to hide one. Promotion and annotation only.
- **Measuring with the Classifier.** Nesting depth, length and complexity are
  numbers a parser gives exactly and for free; asking a model for them adds
  cost and error. The Classifier gets the numbers as context and judges.
- **Storing backend credentials on Hosts.** It would put long-lived keys on
  every Host, including shared VMs and Pis, and need a secure store on each.
  Keeping them in the client's OS store and lending them per review keeps one
  place to revoke.

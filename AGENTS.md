# Polaris — agent guide

Polaris is an IDE and agent orchestrator: a Bun Daemon per Host, an Electron Desktop App, and later a React Native Mobile App. Read these before changing anything:

- `CONTEXT.md`: the glossary. Use its terms exactly (Host, Daemon, Workspace, Agent Session, Turn, Session State…) in code, comments and UI copy.
- `PRODUCT.md` and `DESIGN.md`: product truth, voice and the UI spec.
- Any user-facing work (Paper mockups, the Desktop App, copy, brand): load the `product-design` skill (`.agents/skills/product-design/`) first.
- The decisions behind the architecture are on the Linear map ENG-167 (each closed ticket holds its resolution); research is under `docs/research/`.

## Layout

| Path | What |
|---|---|
| `packages/protocol` | The wire contract: Effect Schema domain, events, commands, the `DaemonRpcs` group, and frame codec. Every Client and the Daemon depend on it. |
| `packages/client` | Client runtime: connections to many Daemons over SSH, Connection State, resume, install/upgrade. |
| `packages/bench` | Benchmarks: the real Daemon under scripted load, a process-tree memory/CPU sampler, baselines and comparisons. |
| `packages/spec` | The Quint spec of commits, streams, Client feeds and approvals, and its checks (see Verification). |
| `apps/daemon` | The Daemon (`polaris` binary): event store, Harness drivers, transport, files, git, terminals, user service. |
| `apps/site` | The marketing site (Next.js on Vercel, root directory `apps/site`), built from the Paper "Marketing site" page on `@polaris/ui`'s tokens; the download and update-feed routes live under `app/` (see its README). |
| `apps/desktop` | The Electron Desktop App: the Client runtime in the main process, a typed IPC bridge, a React renderer on `@polaris/ui` (see its README). |
| `packages/ui` | The design system in code (`@polaris/ui`): DESIGN.md's tokens on Tailwind v4, restyled shadcn/ui, the Polaris primitives, and a gallery (`bun run --cwd packages/ui gallery`). |
| `packages/lint-config` | The shared oxlint config every workspace extends, the shared oxfmt style (`oxfmt.json`), and the custom plugins (`polaris/no-long-comment`, vendored anti-slop, the SonarJS cognitive-complexity wrapper). Read its `README.md` before touching lint rules. |
| `tooling` | The lint ratchet and its baseline (`tooling/lint`), the quality runner behind the git hooks (`tooling/quality`), and the hooks (`tooling/hooks`). |

## Stack and conventions

- Bun ≥ 1.3.9 (pinned in `packageManager`), Turborepo, TypeScript 7, oxfmt (formatting), oxlint (linting).
- **Effect 4** (`effect@4.0.0-rc.118`, pinned exactly; the `@effect/*` packages must match). APIs differ from Effect 3: read `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` rather than relying on memory. RPC is `effect/rpc`, SQL is `effect/sql`, sockets `effect/socket`.
- Services use `Context.Service`; functions use `Effect.fn`; errors are `Schema.TaggedError`.
- Tests use `bun test`, next to the code as `*.test.ts`.
- Never use node-pty; terminals use `Bun.Terminal`.
- **Lifecycle changes go through the state machines**, never ad-hoc `if (state === …)` code: Session States through the Agent Session machine (`apps/daemon/src/engine/session.ts`, the engine's pure decider; see its README), Connection States through `packages/client/src/connection.ts`. They use XState v6 (`xstate@6.0.0-alpha.61`, an alpha, pinned exactly): read the bundled types in `node_modules/xstate/dist/declarations` rather than v5 docs or memory. The event log stays the source of truth: a machine snapshot is always derived from folded events, never kept only in an actor. Update the model-based tests (`*.testing.ts`, `*.graph.test.ts`) and the Mermaid diagrams with the machine.
- Run `bun run typecheck && bun run test && bun run lint` before committing.

## Lint and maintainability

oxfmt formats (`bun run format`; config in `oxfmt.config.mts`, built on `packages/lint-config/oxfmt.json`); oxlint lints, with the shared config in `packages/lint-config` (its `README.md` has the full rule list and policy). `bun run lint` is oxfmt's format check plus the lint ratchet.

Repo-wide formatting commits are listed in `.git-blame-ignore-revs`, GitHub's blame skips them; locally run `git blame --ignore-revs-file .git-blame-ignore-revs`, or `git config blame.ignoreRevsFile .git-blame-ignore-revs` once (git then fails to blame in checkouts without the file, such as branches older than it). Add any future formatting-only commit there.

- **The ratchet.** Existing violations are counted per file and rule in `tooling/lint/baseline.json`. Lint fails when a count goes up, so new files must be fully clean and old files may not get worse. When you fix baselined violations, run `bun run lint:baseline` and commit the lowered counts with the fix. Never raise a count by hand; `--rebaseline` is only for introducing a new rule, and says so in the commit.
- **Size and complexity.** Files stay under 750 lines (blank lines don't count; comments do) and functions under a cognitive complexity of 15. Split along seams: a folder whose `index.ts` is the module's interface, never a `utils.ts` dumping ground.
- **No disable comments** for `max-lines` or `sonarjs/cognitive-complexity`. Any other `oxlint-disable` needs a reason next to it and will be questioned in review.
- **Comments**: at most two lines of prose (`polaris/no-long-comment`). A comment says what the code does or warns about a trap at this call site; *why* the code is this way goes in an ADR under `docs/adr/`, with a one-line pointer. JSDoc on an API is exempt.
- **Type assertions** need a `// SAFETY: …` line stating the invariant that makes them true. Parse `unknown` at the boundary with Effect Schema rather than passing it around or narrowing with `typeof`.
- **Effect rules** (anti-slop-effect, on everywhere):
  - `no-manual-tagged-construction`: build tagged values with their Schema `.make` / class constructor, so they're checked.
  - `no-manual-tag-comparison`: branch on `_tag` with `Match.tag`/`Match.tags` or `Predicate.isTagged`, so exhaustiveness is checked.
  - `prefer-effect-match`: a chained literal ternary over one value becomes a `Match`.
  - `no-manual-effect-error-tag`: handle tagged errors with `Effect.catchTag`/`catchTags`, not by inspecting `_tag` in a broad catch.
  - `no-service-constructor-imports`: runtime code yields a service from its Layer instead of importing its `make…` constructor.

## Git hooks

`bun install` points git at `tooling/hooks` (`core.hooksPath`, a relative path, so each checkout and worktree runs its own copy against its own `node_modules`; a checkout without dependencies installed is refused with a message).

- **pre-commit**: formats fully staged files with oxfmt and restages them, only checks partially staged ones, and lints staged files through the ratchet.
- **commit-msg**: strips `Claude-Session:` trailers and claude.ai session URLs; this repo doesn't record them.
- **pre-push**: re-checks format and lint on the files in the pushed commits, then typechecks and tests the changed packages and their dependents (`turbo --filter=...[base...head]`).
- **By hand**: `bun run quality <files…>` (fix), `--check`, `--dirty`, or `--range <a>..<b>`.

Never bypass a hook with `--no-verify`. If one is broken, fix it or say so.

## Performance

Performance is a product requirement: the Daemon must stay light on a Raspberry Pi 4 and a small Linux VM as well as a Mac, and the Desktop App has budgets (< 1 GB total in a heavy session, ≥ 120 Hz, Workspace switch < 100 ms). See `packages/bench/README.md`.

- Before and after a change that could move memory, CPU or latency (engine, store, streams, transport, wire, files, git, terminals, Harness drivers, anything on a hot path or a timer), run the relevant scenarios against the committed baseline for your machine, e.g. `bun run bench sessions history --runs 3 --compare packages/bench/baselines/<machine>.json`. Use `--profile` to see where the time and memory go.
- Never regress a baseline silently: fix the regression, or explain it in the commit and update the baseline (`--save-baseline`) in the same change.
- Anything that wakes an idle Daemon (timers, polling, watchers) must justify itself in the `idle` scenario.

## Verification

The event store, the Engine's streams, recovery and approvals, and the Client's resume are specified in `packages/spec/polaris.qnt` (Quint) and tested against the real code by the model-based tests in `apps/daemon/src/verification/`. See `packages/spec/README.md`.

- A change to the protocol, `apps/daemon/src/engine/`, `apps/daemon/src/store/` or `packages/client/src/resume.ts` that changes how commands are decided, committed, acknowledged, streamed, resumed or recovered must update the spec (and its README mapping) in the same change, and keep the spec checks, the model-based tests and trace validation green.
- Run locally: `bun run spec` (Quint typecheck, scenario tests, simulator), `bun test apps/daemon/src/verification` (model-based tests; `POLARIS_PBT_RUNS=500` for a longer run, `POLARIS_PBT_SEED` to replay a failure), and trace validation as in the spec README. `bun run spec -- --verify` also runs Apalache (Java 17+).
- A bug they find that you cannot fix in the same change goes into `apps/daemon/src/verification/findings.test.ts` as a `test.todo` with a note, and into the spec README's Findings.

## Attribution (required)

Polaris is Apache-2.0. When you copy or adapt code from another project (rather than depending on it):

1. Only copy from permissively licensed sources: MIT, Apache-2.0, BSD, ISC, 0BSD, Unlicense, MPL-2.0 (file-level). **Never copy from GPL or AGPL sources**, and don't read them for code (Waku, Codux, Farcaster are out). herdr is Apache-2.0 only from commit `cd5ea1be` onward; never take anything earlier.
2. Pin the exact upstream commit.
3. Add a header to every file with borrowed code, e.g. `// Portions adapted from pingdotgg/t3code@de251fc (MIT)`.
4. Add an entry to `ATTRIBUTION.md`: source repo, pinned commit, licence, the Polaris files it landed in, and what changed.
5. Run `bun run licenses:check` before committing; it fails on dependencies outside the allowlist.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

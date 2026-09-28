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
| `apps/daemon` | The Daemon (`polaris` binary): event store, Harness drivers, transport, files, git, terminals, user service. |
| `apps/desktop` | The Electron Desktop App (not started yet). |

## Stack and conventions

- Bun ≥ 1.3.9 (pinned in `packageManager`), Turborepo, TypeScript 7, Biome.
- **Effect 4** (`effect@4.0.0-rc.118`, pinned exactly; the `@effect/*` packages must match). APIs differ from Effect 3: read `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` rather than relying on memory. RPC is `effect/rpc`, SQL is `effect/sql`, sockets `effect/socket`.
- Services use `Context.Service`; functions use `Effect.fn`; errors are `Schema.TaggedError`.
- Tests use `bun test`, next to the code as `*.test.ts`.
- Never use node-pty; terminals use `Bun.Terminal`.
- Run `bun run typecheck && bun run test && bun run lint` before committing.

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

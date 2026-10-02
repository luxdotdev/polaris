# Editor language tooling research

Snapshot: 2026-10-02. Read-only checkout and primary-documentation research
for [the M3.1 build plan](../specs/editor-language-tooling-m3.1.md). No language
server was installed or launched; feature parity and resource costs remain
implementation gates. Context7 was used for LSP and available library docs;
other catalog entries were checked against primary upstream documentation.

## Verified starting point

- `CONTEXT.md` assigns Host language tooling to the Daemon.
- `docs/specs/editor-m3.md` assigns unsaved buffers to the Desktop App and keeps
  Agent Sessions on saved files. Language-server access to unsaved text is now
  explicitly settled without changing either ownership rule.
- CodeMirror 6 has lazy grammar loading and per-file extension registration in
  `apps/desktop/src/renderer/features/editor/`.
- Markdown and YAML grammars already exist. Markdown preview does not exist;
  Prisma and `.env` fall back to plain text. MDX currently maps to Markdown.
- File saves are versioned. The existing file RPCs do not provide a multi-file
  workspace-edit transaction.
- Source tabs currently identify a path, and their `preview` flag means an
  unpinned source tab. Markdown preview needs a distinct view identity while
  sharing the same Host/path source buffer.
- An Editor root can be a Workspace, Worktree, or Review Checkout. Language
  tooling must account for the actual directory being edited.

## Sightline compatibility cases

These are checkout observations, not requirements to change Sightline.

- A pnpm monorepo has nested TypeScript configurations and Python environments.
- `apps/web/tsconfig.json` declares Next, Effect, and Workflow language-service
  plugins. Sightline's `AGENTS.md` specifies a project-local TS6 JavaScript API
  slot for editor plugins alongside its TS7 native build compiler.
  Its alias package forwards to TypeScript but does not ship `tsserver.js`;
  discovery must find the actual server dependency and resolve plugin probe
  locations. Plugin behavior has not been tested with a running server.
- Prisma configuration lives in `packages/db/prisma.config.ts`, with schema at
  `packages/db/prisma/schema.prisma` and generated TypeScript clients.
- The Rust Cargo root is nested in `apps/overseer/src-tauri`.
- Go needs a separate compatibility fixture; no Go module was found in the
  inspected Sightline manifests.

## Candidate managed catalog

Provisional choices from upstream documentation, not tested release pins.
Server capability gaps must be tested rather than inferred from this list.

| Languages | Candidate | Important boundary |
| --- | --- | --- |
| JavaScript / TypeScript | typescript-language-server + project TypeScript | Resolve actual SDK and plugin locations, including aliases. |
| HTML / CSS | vscode-langservers-extracted | Separate HTML and CSS servers; grammar support remains independent. |
| Python | Pyright or basedpyright + Ruff | Interpreter discovery and formatting/linting are distinct. |
| Bash / Shell | bash-language-server + ShellCheck + shfmt | Bash/sh support does not promise zsh/fish parity. |
| Java | Eclipse JDT LS | Needs a Java 21+ server runtime, separate from project JDK. |
| PHP | Phpactor or user-configured Intelephense | Phpactor needs a trial; Intelephense has paid feature gates. |
| Go | gopls | Needs a compatible Go toolchain on the Host. |
| Rust | rust-analyzer | Project toolchain and rust-src remain distinct prerequisites. |
| Lua | LuaLS | Runtime/library settings vary across projects. |
| SQL | sql-language-server | Editing/dialect scope only; do not enable query execution or database connections. |
| Prisma | @prisma/language-server | Standalone server; validate Sightline schema/config behavior. |
| YAML | yaml-language-server | Schema associations supply much of its assistance. |
| GitHub Actions | @actions/languageserver | Distinct expression support; upstream maintenance is limited. |

Exact versions, Host platform coverage, distribution licensing, resource costs,
and actual feature parity remain unverified. Installation is planning scope;
no software has been installed by this interview.

## Architecture constraints and evaluation work

- Keep syntax grammars lazy and local to the Desktop App. Host language servers
  receive document versions over the existing Client/Daemon connection path.
- Separate reusable Host installations from Client/checkout document contexts.
  Install deduplication must work across simultaneous opens and Settings actions.
- Existing Client installation code offers OS/architecture/libc detection,
  progress, verification, and atomic activation patterns. Its complete Daemon
  installer is not a language-tool installer and must not be reused wholesale.
- Host runtime/prerequisite availability should reuse bounded probes, cached
  results, explicit refresh, and feeds rather than new idle polling.
- `@codemirror/lsp-client` 6.3.0 is an MIT feature-layer candidate, not a complete
  broker for this scope. Current source rejects server-originated requests;
  built-in rename covers only open files and `changes`; the formatting command
  does not expose an awaitable save preflight; multi-provider aggregation and
  code actions need additional support. Evaluate extension versus a separate
  protocol client before choosing the implementation library.
- Existing Streamdown static rendering, Shiki, and strict-mode Mermaid are
  reuse candidates. Markdown needs Host-aware media and links; the current CSP
  blocks arbitrary external images and `app://polaris` serves renderer assets.
- Managed artifact licensing/provenance is not covered automatically by the
  current dependency license checker. Audit pinned artifacts and their notices
  as part of the catalog release process, including externally run JDT LS.

## CodeMirror client provenance

The canonical repository moved away from GitHub. The archived GitHub snapshot
is 6.2.2 and lacks initialization options added in the verified 6.3.0 release.
Current 6.3.0 was inspected from public npm metadata and selected MIT source
sections in its tarball, in memory, without installing it. Its JSON-message
transport can wrap a Host relay, but has no process/reconnect policy. The
built-in singleton EditorView plugin does not aggregate multiple providers.
Rename handles only tracked open files and changes; all server-originated
requests receive MethodNotFound. Formatting starts asynchronously but the
command immediately returns a Boolean, so cannot be awaited as save preflight.

- [Version metadata](https://registry.npmjs.org/@codemirror%2flsp-client/6.3.0)
- [Exact artifact](https://registry.npmjs.org/@codemirror/lsp-client/-/lsp-client-6.3.0.tgz)
- [Canonical repository](https://code.haverbeke.berlin/codemirror/lsp-client)

## Existing reuse seams

- [Editor feature registration](../../apps/desktop/src/renderer/features/editor/api.ts)
  and [buffers/save coordinator](../../apps/desktop/src/renderer/features/editor/runtime/buffers.ts).
- [Language detection](../../apps/desktop/src/renderer/features/editor/model/language.ts)
  and [grammar loaders](../../apps/desktop/src/renderer/features/editor/cm/languages.ts).
- [Host installer](../../packages/client/src/install/remote.ts) and
  [platform mapping](../../packages/client/src/install/builds.ts): use mechanics,
  not the bundled-Daemon install plan.
- [Harness availability](../../apps/daemon/src/harness/availability/README.md):
  bounded cached probes/feeds, explicit refresh, no idle polling.
- [Settings storage](../../apps/desktop/src/main/settings.ts) and
  [Editor Settings](../../apps/desktop/src/renderer/features/settings/ui/EditorPage.tsx).
- [Static Markdown](../../apps/desktop/src/renderer/features/review/overview/ui/markdown/Rendered.tsx),
  [lazy plugins](../../apps/desktop/src/renderer/features/session/ui/markdown/plugins.ts),
  and [CSP/app protocol](../../apps/desktop/src/main/protocol.ts).
- [License checker](../../scripts/licenses.ts) and [binary precedent](../../ATTRIBUTION.md):
  managed language downloads require an artifact audit beyond workspace dependencies.

## Sources

- [LSP capability negotiation](https://microsoft.github.io/language-server-protocol/overview)
- [Standalone Prisma language server](https://github.com/prisma/language-tools/blob/main/packages/language-server/README.md)
- [TypeScript server configuration](https://github.com/typescript-language-server/typescript-language-server/blob/master/docs/configuration.md)
- [YAML language server](https://github.com/redhat-developer/yaml-language-server)
- [VS Code Markdown preview](https://code.visualstudio.com/docs/languages/markdown#markdown-preview)
- [TypeScript language server](https://github.com/typescript-language-server/typescript-language-server)
- [HTML/CSS server distribution](https://github.com/hrsh7th/vscode-langservers-extracted)
- [Pyright configuration](https://github.com/microsoft/pyright/blob/main/docs/configuration.md)
- [basedpyright](https://docs.basedpyright.com/latest/)
- [Ruff editor integration](https://docs.astral.sh/ruff/editors/)
- [Bash language server](https://github.com/bash-lsp/bash-language-server)
- [Java language server](https://github.com/eclipse-jdtls/eclipse.jdt.ls)
- [Phpactor](https://github.com/phpactor/phpactor)
- [Intelephense feature gates](https://github.com/bmewburn/intelephense-docs/blob/master/features.md)
- [gopls](https://go.dev/gopls/)
- [rust-analyzer installation](https://rust-analyzer.github.io/book/installation.html)
- [Lua language server](https://github.com/LuaLS/lua-language-server)
- [SQL language server](https://github.com/joe-re/sql-language-server)
- [GitHub Actions language server](https://github.com/actions/languageservices/blob/main/languageserver/README.md)
- [CodeMirror LSP client](https://github.com/codemirror/lsp-client)
- [Streamdown static rendering](https://github.com/vercel/streamdown/blob/main/apps/website/content/docs/usage.mdx)

VS Code's preview updates live and can follow the active Markdown document or
be locked to one. Its documented rendering target is CommonMark rather than
full GitHub-flavored Markdown; Polaris's rendering fixtures must cover its
explicit GitHub-style scope independently.

---
status: accepted
fixes: the diagnostics verifier never attaching on the default TypeScript server (ADR 0050)
---

# TypeScript 7 is the default TypeScript server

Owner decision, 2026-10-15: Polaris follows the latest TypeScript major, and
its managed TypeScript and JavaScript server becomes TypeScript 7's native
`tsc --lsp`. Until now the managed server was typescript-language-server 6.0.1
over tsserver 6.0.3 on Polaris's private Node, and TypeScript 7 ran only for a
trusted project that ships its own. The diagnostics verifier (ADR 0050) needs a
pull-diagnostics server, so with the old default it never ran.

## Decision

- **A managed `typescript-go` tool**, TypeScript 7.0.2's per-platform npm
  packages (`@typescript/typescript-<os>-<arch>`), pinned by SHA-256 as a
  runtime upstream download (ADR 0022: Apache-2.0, LICENSE and NOTICE.txt
  retained). It is one static binary, so it needs no Node. darwin arm64 and
  x64, and linux arm64 and x64; the Linux builds are statically linked, so
  musl Hosts use them too. Windows has no Daemon yet, so there is no Windows
  artifact.
- **Which server runs.** The provider id stays `typescript-language-server`,
  the TypeScript slot everything keys on; the tool behind it is chosen per
  launch (`typescriptTool` in `composition/managedPolicy.ts`):
  - no Trust, or no project TypeScript: managed `tsc --lsp`;
  - a trusted project's own TypeScript 7: its own `tsc --lsp`, as before;
  - a trusted project on TypeScript 6 or older, or with tsserver plugins:
    typescript-language-server over the project's tsserver, as before, with
    Node, TypeScript 6.0.3 and typescript-language-server downloaded only then.
- **That fallback stays** because TypeScript 7 loads no tsserver plugins (Vue,
  Angular, styled-components) and a project pinned to an older compiler should
  get its own checker after Trust. Before Trust, an older project already got
  Polaris's compiler rather than its own, so TypeScript 7 replaces TypeScript
  6.0.3 there. `tsc --lsp` serves a TypeScript 5 tsconfig acceptably: `paths`
  still resolve without `baseUrl`, and files type-check. The removed options
  (`target: es5`, `moduleResolution: node`, `baseUrl`, `downlevelIteration`,
  `importsNotUsedAsValues`) are errors only in `tsconfig.json`, which the
  Editor does not send to this server.
- **No fallback on a failed start.** Every Host Polaris supports has a build, so
  there is no "no build" case. A server that fails shows the usual failed
  state with Restart; a project can pin TypeScript 6 or name its own server
  under Advanced.

## Feature gaps (TypeScript 7.0.2)

Completions (with auto-imports on resolve), hover, signature help, definition,
type definition, implementation, references, rename, formatting, symbols,
quick fixes (the import Edit Predictions use; TypeScript 7 sends them as plain
edits with no `_typescript.applyCodeActionCommand`) and pull diagnostics work.
Refactor code actions (extract, move, inline) are not offered, so the code
action menu over a selection is empty; semantic tokens return an empty legend
(the Editor does not use them); there is no `workspace/executeCommand`.

## Cost

Same run, `dv-wired.ts … idle` on this repo (82 files opened and typed in,
281 s, M2 Max at load 7–9), server processes only:

| Server | Peak RSS | CPU |
|---|---:|---:|
| `tsc --lsp` 7.0.2 (managed) | 1.6 GB | 55 s |
| typescript-language-server 6.0.1 + tsserver 6.0.3 | 3.0 GB | 187 s |

On the Raspberry Pi 4 (4 GB), opening one file of `packages/protocol` with
Effect: 118 MB, first diagnostics in 0.56 s and 1.7 CPU-seconds, against
415 MB, 8.3 s and 15.5 CPU-seconds for tsserver. TypeScript 7 checks on
several threads, so its CPU arrives in shorter bursts. A repo the size of this
one (1.6 GB) is still heavy for a 4 GB Pi, as tsserver was at twice that. No
fallback is needed for the Pi: the linux-arm64 build serves it. Each verifier
check (ADR 0050) adds about 0.8 s of server CPU on the Mac, more on a Pi; it is not
measured there.

## Rejected

- A second TypeScript 7 server for verification only beside tsserver: two
  servers' memory for one feature.
- Removing typescript-language-server: plugin projects would lose their
  plugins after Trust.

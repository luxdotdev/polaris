# Editor language tooling, v2

Status: accepted by the owner on 2026-10-06. Supersedes
[M3.1](./editor-language-tooling-m3.1.md), whose salvaged code is reused where
useful but not binding. This is a build plan, not a report of implemented behavior.

- Glossary: CONTEXT.md, especially Language Integration, Trust, Prerequisite,
  Command Palette, Host, Workspace, Worktree, Review Checkout and Editor.
- Decisions: ADRs 0013–0015, 0016 as amended by 0019.
- Background: [M3.1 retrospective](../reports/m31/RETROSPECTIVE.md) and
  [trust recovery](../reports/m31/TRUST-RECOVERY.md).

## 1. Done means

TypeScript/JavaScript and Python work with zero configuration in this repo and
one small fresh repo, on the owner's Mac and on `lucas-rpi`: diagnostics, hover,
go-to-definition and rename. Every slice ends in an acceptance script, written
in its ticket, that passes twice: once as an automated run driving the real
Electron app against a real Daemon, and once by the owner by hand. Code that
exists but has not passed both is not done.

## 2. Tooling

- **Sources.** Each server is the project's own upstream release (npm tarball or
  GitHub release), pinned by version and sha256 in the catalog, for every Host
  platform including linux-arm64. Nothing is built from source.
- **Runtime.** Polaris ships a private Node for npm-based servers. Interpreters
  and toolchains are Prerequisites: detected, reported with the command to
  install them, never installed.
- **Install.** On first use, silently, deduplicated per Host/tool/version, with
  progress in the status pill. Settings has "Download language tools
  automatically", on by default. Pinned versions change only with a Polaris
  release; there is no in-app update or rollback flow.
- **TypeScript.** Without Trust: managed `typescript-language-server` with a
  bundled TypeScript. With Trust: the project's TypeScript; TS 7 uses its native
  language server rather than `lib/tsserver.js`. A command switches between them.
- **Python.** basedpyright for types and Ruff for lint and format. The
  environment comes from `.venv` or uv; with none found, "needs Python" shows as
  a Prerequisite. Reading the environment needs no Trust.
- **Go.** gopls and the Go toolchain are Prerequisites; Polaris never downloads
  or builds gopls (the pill gives `go install golang.org/x/tools/gopls@latest`).
  gopls starts only after Trust, since loading packages runs `go list`; it
  formats with gofmt (ADR 0035).
- **PHP.** Managed Phpactor PHAR on the Host's PHP 8.2+, a Prerequisite. Before
  Trust: no Composer, project config or project tools, and nothing forks (ADR
  0035). After Trust: the normal configuration, and php-cs-fixer formats when
  the project has it.
- **Rust.** Managed rust-analyzer; cargo and rustc (via rustup) are a
  Prerequisite. Before Trust: local analysis only, nothing in the project runs
  (ADR 0034). After Trust: the normal configuration and the project's toolchain;
  rustfmt formats.
- **Lua.** Managed lua-language-server, no Prerequisite; a `.luarc` plugin runs
  only after Trust. StyLua formats after Trust where the project configures it,
  otherwise the server's formatter.
- **Java.** Skipped (owner: Java users use IntelliJ).

## 3. Trust

- Managed servers run without Trust. Trust is asked for only when a Language
  Integration would run Workspace code (its TypeScript, tsconfig plugins,
  formatters, build scripts).
- The first such moment raises a popup in the Editor, as in VS Code: **Trust**
  or **Not now**. Both are remembered per Workspace on that Host, across
  restarts. Commands revoke Trust or ask again.
- A Worktree inherits its Workspace's Trust; a Review Checkout never does.
- Trust failures are tagged errors end to end; nothing matches on error text.

## 4. Server lifecycle

- Start when the first file of the language opens; stop about 10 minutes after
  the last one closes.
- Restart on crash with backoff; after 3 crashes, stop and show the failure.
- Restart when the project's TypeScript version or tsconfig changes, through the
  existing file watcher (no polling). Every restart resends unsaved text.
- The language subsystem loads on first use, so an idle Daemon carries none of
  it; the `idle` bench scenario proves the M3.1 regression (~10 MiB) is gone.

## 5. Settings

- Host-bound settings (custom servers, executable overrides, environments) live
  on the Host so every Client sees them. Preferences (format on save, formatter
  choice) follow the user across Clients.
- Trust lives on the Host and never appears as a setting to fill in.

## 6. Surfaces

All designed in Paper, informed by Mobbin (Zed, VS Code, Cursor, JetBrains),
before any UI code. The current `settings/languages/` folder is replaced, not
restyled.

- **Status pill** in the Editor: the current file's Language Integration and its
  state (installing, ready, needs a Prerequisite, Trust not given, failed), with
  a popover that explains and offers the fix.
- **Trust popup** as in section 3.
- **Settings → Editor → Languages:** one list, each Language Integration with its
  state and an on/off switch; custom servers under a collapsed Advanced.
- **Language server log:** a read-only Editor tab, linked from the popover.
- **Command Palette (⌘⇧P):** its own surface, separate from the jump menu. Fed by
  the `shared/keymap.ts` registry, extended with a per-command availability
  condition and with commands contributed by features. Commands leave the jump
  menu (⌘K), which becomes navigation only. First commands: restart the language
  server, restart all language servers in the Workspace, Trust / revoke Trust /
  ask again, TypeScript: use project or bundled version, show the language
  server log, format document; later, Python: select interpreter. The full
  command set and easter eggs are a separate track.

## 7. Slices

Small and sequential; subagents may parallelize within a slice. Slice 3 runs
alongside 1–2.

| # | Slice | Proven by |
|---|---|---|
| 1 | Zero-config TypeScript on macOS, without Trust: managed install path on, upstream downloads, private Node, bundled TS, lazy subsystem | Open a TS file in this repo and a fresh repo; diagnostics, hover, definition, rename; `idle` bench at baseline |
| 2 | Trust: popup, remembered choices, project TypeScript and TS 7 native server, tagged errors | First TS file raises the popup once; both answers persist across restarts; project TS in use after Trust |
| 2b | Server lifecycle (§4): idle stop, crash backoff to a visible stop, restart on TypeScript or tsconfig change through the existing watcher | Kill the server three times and it stops with the failure shown; change tsconfig and diagnostics refresh without a manual restart; `idle` bench at baseline |
| 2c | Opening another file in a checkout whose server is running reuses it: no re-discovery, re-acquire or tooling re-check (owner, 2026-10-07: opening a second TS file re-checked tooling and was slow) | Time-to-hover on a second file in the same checkout is under 200 ms in the real app; the log shows no second discovery |
| 3 | Design: Mobbin research, Paper mockups of the pill, popup, language list and Command Palette | Owner signs off the mockups |
| 4 | Build the designed UI and the Command Palette with the language commands; delete the old settings folder | The commands and states in section 6 work in the app |
| 4b | Markdown: highlighting for headings, emphasis, links, inline code and fenced code in the moonlit theme, both themes; check the M3.1 source/preview pair still works (owner, 2026-10-07: highlighting missing) | Open README.md and DESIGN.md: each Markdown construct is styled; ⇧⌘V preview renders |
| 5 | Python: basedpyright, Ruff, environment detection, select interpreter | Same four features in a uv project; "needs Python" on a Host without one |
| 6 | Remote Host: slices 1, 2 and 5 on `lucas-rpi` | The same scripts on the Pi |
| 7 | More languages: JSON/CSS/HTML, then SQL, Rust and the rest of the Stack Overflow survey top 10 | One script per language |
| 8a | Rust (managed rust-analyzer; the Rust toolchain is a Prerequisite; before Trust no build scripts, proc-macros or `cargo check`, ADR 0034) and Lua (managed lua-language-server; a `.luarc` plugin runs only after Trust; StyLua formats after Trust where configured). Java is skipped | A Cargo crate and a Lua file get hover, diagnostics, completion, definition and format on save; before Trust nothing in the crate runs; both start on `lucas-rpi` |
| 8b | Go (gopls and the Go toolchain are Prerequisites, gopls after Trust) and PHP (managed Phpactor on the Host's PHP; before Trust no Composer, config or project tools; php-cs-fixer formats after Trust when the project has it), ADR 0035. Java is skipped | A Go module and a Composer project get hover, diagnostics, completion, definition and format on save after Trust; before Trust PHP gives that subset without running project code; with gopls missing the pill gives `go install` and Check again finds it (`goPhpLanguageSmoke.ts`, `goPhp.live.testing.ts`) |

## 8. Out of scope

Building servers from source, installing interpreters or toolchains, in-app
server updates, a plugin marketplace or VS Code extension host, database
connections, and Agent access to language intelligence. M3.1's draft-based
refactors and Markdown preview stay as shipped.

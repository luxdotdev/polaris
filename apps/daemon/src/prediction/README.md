# Host prediction context

`prediction.context` uses the existing lazy Host language graph, registered
checkout resolver, Trust service, authenticated connection and LanguageBroker.
It never acquires or synchronizes a language context. Only a Ready UTF-16 server
owned by the current Editor connection, with exactly the submitted draft, can
contribute LSP context. Trust is mandatory here even for bundled servers which
can otherwise run before Trust. Revocation, replacement, document edits and
connection loss fence results before return.

The language graph registers a thin lazy handler. The assembler and outline
parser import only on the first `prediction.context` request, with one cached
build in the Daemon scope. Native tree-sitter and its grammars load only when
that request parses supported code; no prediction WASM or grammar loads at startup.

The request path selects the most specific registered Workspace, Worktree or
ready Review Checkout. Relative paths are relative to the Workspace. Import
outlines currently support TypeScript/JavaScript local relative imports (four
modules, no recursive graph walk). Tree-sitter extracts exported signatures;
no Workspace code or module loader runs. Files are at most 128 KiB, read through
held descriptors beneath the canonical checkout, with symlink/root checks.
Larger files and unsupported languages still get bounded LSP context and edits.

Definitions use hover, definition targets and document symbols from existing
sessions; diagnostics reuse versioned publications. Request deadlines expire
70 ms after selecting the session; unavailable methods degrade to other pieces.
Stable definitions and outlines precede diagnostics and frozen edit hunks.
`packages/predict` counts and packs all text including source labels. Its default
UTF-8 byte counter is deliberately conservative, not the model tokenizer.

Caches contain at most 32 bounded file parses; exact text comparison invalidates
on both buffer and imported-file edits without watchers. Edit snapshots are
scoped to the exact connection and file. They update on the first request after
a 500 ms pause, detected by comparing request times. There are no new polling
loops or background timers. Cold lazy initialization is reported separately.

## Auto-import seam

v1 does not request completions speculatively or apply additionalTextEdits.
A future adapter can consume an Editor completion result already retained by
`runtime/FeatureEvidence`, select candidates for identifiers in generated text,
and emit their label and import signature as definition pieces. It must retain
the original `LanguageFeatureRequest`/fence and route additionalTextEdits through
existing preparation and proposal authorities after acceptance. A model-produced
piece is never edit authority. This keeps import edits out of ghost acceptance
until the Client can validate the exact captured completion item.

## Edit Predictions

`prediction.edit` is advertised alongside `prediction.complete` and is ephemeral:
no EventStore, file writes, receipts or recovery state. Its handler imports the
shared `createEditPredictor` only on first consumption. Closing the RPC stream
aborts the predictor's HTTP signal. The request carries the whole unsaved buffer,
optional focus and frozen edit history; success streams one `EditPredictionItem.Final`.
No model server process, download, polling or idle timer is introduced.

## Managed model server (`managed/`, ADR 0048)

The Daemon runs the tab completion model server itself when the user has no
server of their own: `catalog.ts` pins the llama.cpp release (b11429) per
platform and the two models (Sweep Next-Edit 1.5B Q8 by default, Zeta 2.1 Q4
opt-in) with their checksums; `download.ts` downloads resumably (`.part`,
Range, SHA-256, atomic rename) after a free-space check; `process.ts` picks a
free loopback port (never 8080, 1234 or 11434), spawns llama-server with the
spec's flags and verifies `/health` and that `/v1/models` lists the alias;
`machine.ts` is the XState decider over the phases (`Unsupported`, `Absent`,
`Downloading`, `Verifying`, `Stopped`, `Starting`, `Serving`, `Backoff`,
`Failed`); `server.ts` supervises it with backoff, keeps the last 40 stderr
lines, starts lazily on the first request and unloads after 15 idle minutes;
`rpc.ts` serves `prediction.managed` (status and the setup / cancel / start /
stop / remove actions) and `prediction.managed.watch`. `prediction.complete`
and `prediction.edit` start it on demand when the request names its endpoint.
The only timer is the idle unload, armed while a server runs and unref'd; the
health poll runs only while `Starting`.

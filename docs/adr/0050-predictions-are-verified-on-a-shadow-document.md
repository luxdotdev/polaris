---
status: accepted
fixes: EP7, the diagnostics verifier in the Editor (docs/research/next-edit-spike.md, "Diagnostics verifier")
---

# Predictions are verified on a shadow document

Before a model Final shows, the file's language server checks the edited
text, and the prediction is suppressed if it adds an error
(`verifyDiagnostics` in `@polaris/predict`). The check must not disturb the
user's document: no diagnostics flash in the gutter or the Problems view,
and no other language feature sees text the user never typed.

## Decision

The edited text goes to a **shadow document**: an unsaved sibling of the
file, `<name>.polaris-verify-<n>.<ext>`, opened on the file's own provider
context through the ordered session queue, read, then closed.

- **Same directory, no leading dot.** Relative imports and the tsconfig
  `include` globs must match, or tsserver puts the shadow in an inferred
  project with other options and reports errors the real file does not have.
  TypeScript's wildcards skip dot-files.
- **A fresh URI per check**, never on disk. The Daemon now accepts a
  document whose file does not exist yet when its directory is inside the
  checkout (`checkoutDocumentPath`).
- **Complete answers only.** A pull report (`textDocument/diagnostic`) when
  the server has one (TypeScript 7), else tsserver's `syntacticDiagnosticsSync`
  and `semanticDiagnosticsSync` through typescript-language-server's
  `typescript.tsserverRequest`. Its pushes are not used: the first one can
  hold only syntax errors, and nothing marks the last.
- **Before is read the same way**, from the user's document at the
  prediction's version, so a partial push cannot make an old error look new.
- **Only TypeScript and JavaScript modules.** A script's or a declaration
  file's copy would redeclare its globals and put errors in the user's file;
  `declare global` and `declare module` are skipped for the same reason.
  Other languages are not measured.
- **Requests wait while a shadow is open.** References, renames and code
  actions on the same context would otherwise list the shadow, and an edit
  fence captured then would go stale when it closes. `LanguageRequests`
  holds a request until the context's shadow closes and then fences against
  the acknowledgment from after the close.
- **Failure.** Past the deadline, a server that can check fails closed
  (`diagnostics-deadline`); a server that cannot, a Host that refuses the
  shadow, or a request error fails open to today's guards. A keystroke aborts
  the check, cancels its Host requests and closes the shadow.

## Rejected

- Sending the edited text to the user's own document: it flashes
  diagnostics and moves every other language feature.
- A second language server for verification: a second tsserver for this
  repo costs hundreds of MB.
- Waiting for typescript-language-server's pushes: measured as ambiguous
  (a first push without semantic errors), so an error could pass.

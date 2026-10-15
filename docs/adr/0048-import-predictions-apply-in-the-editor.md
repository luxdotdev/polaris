---
status: accepted
fixes: EP5b-1, import Edit Predictions (docs/specs/edit-prediction-v1.1.md §5 "Imports")
---

# Import predictions apply in the Editor, fenced by the language request

An import Edit Prediction offers the language server's own quick fix for an
unresolved name. Tab must apply it at once, as one undo step, with the same
100 ms guard as any Edit Prediction.

The right-click menu sends a code action through the refactor controller
(`features/editor/refactors/`, R1): the Host prepares a proposal, the
controller previews it and owns durable acceptance and undo. That path is
asynchronous, needs a Host round trip and a preview, and is built for edits
that may touch other files. None of that fits a single keypress.

## Decision

The selection rule accepts only a fix whose edit inserts text into this one
document (no other files, resource operations, deletions, replacements or
commands, and no annotation that asks for confirmation). Such an edit is
applied by the Editor as a CodeMirror transaction, like any Edit Prediction.

It is fenced twice before it is applied: the buffer must be the exact `Text`
the server answered for, and `LanguageRequests.intentCurrent` must still hold
for the request's captured edit fence (same provider context, its
acknowledgment still covering the request, the same buffer version). If
either fails, the prediction is dropped and nothing is applied.

The quick-fix request runs on its own request lane (`quickfix`), so it never
aborts a code action menu request and the menu never aborts it.

The Daemon now advertises `codeActionLiteralSupport`, `isPreferredSupport`,
`dataSupport` and `resolveSupport` for `edit`. Without literal support, LSP
servers may answer code actions with bare commands and no edits.

## Rejected

- Routing the import through the refactor controller: correct for
  multi-file edits, but its preview and Host round trip break the Tab
  contract, and the selection rule already excludes everything that needs it.
- Waiting on a timer for diagnostics: the lookup waits on the diagnostic
  feed instead and is cancelled by the next edit, so an idle Editor holds no
  timer.

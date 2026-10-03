# Refactor draft groups

R1 owns Client persistence and preview; G2 owns authenticated registration and
format-2 routing. No capability is registered here. `RefactorCoordinator` accepts
injected `RefactorPort` methods, all scoped to a current independently authenticated
Host/Client/checkout/context. Dispose the binding on authenticated context changes. Never derive that authentication from a proposal.

`inventory` returns every text snapshot plus every affected dirty source and
overwritten destination descendant, including unopened persisted drafts. It must
capture current original text, disk version/text, document version, draft revision
and canonical path. Inventory is complete, deterministic and checked again at
acceptance and after persistence. Newer legacy/spilled drafts supersede older
grouped projections; equal timestamps fail closed, unreadable spills never mean
absence, and drafts are checked again after asynchronous reads. Current live
unsaved buffers take precedence. Text/document/draft revisions must match the
acknowledged snapshot. `validate` independently verifies the current
connection, context generation/fence, expiry, document versions and exact resource
snapshots. G2 repeats verification after Host lock waits.

The whole bounded `DraftGroup` is persisted in one strict IndexedDB transaction.
Only transaction completion plus readback permits `draftReceipt`. Original dirty
texts/revisions and the complete ordered decoded proposal are retained through
rename/delete/overwrite, partial operations, restart and undo. A rejected/quota/
abort/unknown transaction cannot certify a receipt. Existing asynchronous spilled
DraftStore acknowledgments are not used as durability evidence.

Private `verifyReceipt(authenticatedContext, proposal, receipt, operationId)` reads
actual persisted group state, compares scope/full SHA-256 fingerprint/ordered
proposal/exact manifests/complete dirty inventory and revalidates current fences.
Verification rereads the group and independent authority after validation waits; changed revisions/state or connection generations refuse the receipt. New mutation requires a prepared group. Unknown or applied groups authorize only
status/reconciliation/guarded undo for the same operation. G2 owns authentication
of the independent context and calls this before mutation and after lock waits.
`validate` and the typed transport must enforce current negotiated capability and
wire limits before requests; overflow fails visibly, never truncates.
`groupStatus(authenticatedContext, groupId, operationId)` is private metadata:
`{groupId, operationId, proposalId, previewFingerprint, state, localRevision,
hostReceiptRevision, drafts}`. It rechecks independent current authority after
awaits, returns the bounded receipt without original text, and never authorizes
new moves. G2 uses it for exact-operation status/retry/recovery only.
Private `store.get/list` contains original text; never expose it as wire output,
log it, or treat a Client-supplied `durable:true` as authentication.

`decide` uses LanguageTreeEditDecision; `get/recover` use format-2 outcomes. Missing
G2 capability fails visibly; no legacy fallback. Unknown outcomes query status by
exact operation ID. `recover` receives the persisted outcome revision for CAS via
the group; Host ownership guards remain authoritative. `current` must refuse
runtime projection over changed text/revision/disk identity. `publish` updates
runtime views synchronously after the complete durable transaction.

E1's injected preparer returns a Host-prepared `LanguageEditProposal` or already
decoded `LanguageTreeEditProposal`. `promoteTextProposal` preserves every decoded
legacy field and adds format2/empty resources only for text-only proposals. It
rejects version/resource metadata before legacy Struct decoding and refuses all
resource operations. R1 never manufactures Host proposal IDs/fences/snapshots.
Raw feature results require authoritative G2 preparation; callbacks stay visibly
unbound until it exists.

Server applyEdit always enters preview, including one-file proposals. User code
actions/rename can use direct single-file undo only when no resource operation is
present. Text drafts are not implicit saves. Autosave must be held for accepted
refactor drafts until the user's next ordinary edit/save.

## Isolated verification bounds

`smoke.testing.ts` runs one loopback Vite server and one sandboxed Electron window
in one temporary profile. The open-collision probe exercises real dirty source/destination buffers with pending settle, strict complete originals and guarded recovery; its execution is pending joint validation. `--resources-only` also performs two three-operation proposals
(create, overwrite-rename, recursive delete), partial recovery and complete undo
with strict reopened group readback, no crash, theme repetition or measurements. It has no production bridge, accounts, SSH or network
provider. All owned processes/profile/cache roots close in finally. Native crash
proof SIGKILLs only its owned isolated Electron App while a bounded 5s fixture transaction is held;
reopen checks the previously committed revision. Quota injection raises the native
QuotaExceededError inside a real strict transaction; this proves rollback handling,
not physical storage exhaustion. Six theme/density screenshots include Reduce
Motion and the colourblind palette. Raw bounded group/path controls and machine
load are retained; no whole-App/frame budget or production Host proof is inferred.

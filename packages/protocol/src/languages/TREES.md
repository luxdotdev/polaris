# Directory resource ownership

`trees.ts` publishes separate tree proposal, acceptance, draft receipt and outcome
contracts. Existing `FileVersion`, regular-file edits and RPC contracts are unchanged.
Consumers must opt into the new contracts only after complete authenticated handlers
and resource-operation verification; these schemas advertise no capability.

A manifest contains its root at the empty relative path, then all descendants
in ascending code-unit order. Files carry the existing byte version; all entries
carry device/inode identity and permission bits. Directories have null byte
versions. Root identity detects replacement even with identical bytes. Directory
mtime is deliberately excluded because moving children changes it; exact membership,
file versions, type, identity and mode still guard descendant edits. Symlinks and
special entries fail closed without traversal. Maximums are 4096 entries, depth 64,
64 MiB total file bytes and 128 snapshots, also bounded across all resource roots.
Overlapping snapshots count toward the aggregate bound.

Every initial source and destination (including absence and overwritten trees)
requires one canonical snapshot. Acceptance repeats the exact preview's fence,
text snapshots and resource snapshots. The trusted integration authenticates the
Host/Client/checkout and generation/sequence/documents on acceptance and after
lock waits. Server applyEdit only produces a preview; it never accepts itself.

R1 must enumerate dirty descendants of every affected source and destination,
persist their original texts/revisions and ordered rename/delete/overwrite
reconciliation in one durable Client draft group, and supply a
`LanguageTreeDraftReceipt`. Its preview fingerprint is SHA-256 of the decoded
complete proposal. Resource snapshots must exactly match, and descendant records
bind canonical paths, buffer versions and draft revisions. The Host cannot infer
Client dirty drafts: the integration must authenticate and verify this receipt,
including completeness against its current document ownership, before any move.
On partial/unknown outcomes R1 retains the group and queries the exact operation
receipt; it must reconcile using applied/restored steps, never replay blindly or
drop dirty overwritten descendants. Undo also requires current Client reconciliation.

Format 2 outcomes retain operation identity, revision CAS and durable acknowledgment
semantics but use complete trees in each ordered step's before/owned observations.
Private same-filesystem backup moves retain source and overwritten trees for guarded
reverse recovery. No filesystem-wide atomicity or compare-and-rename is claimed;
external changes in the final check-to-rename interval remain an OS race boundary.

## Wire routing and effective limits

Proposal, acceptance, draft receipt and outcome carry explicit `format: 2` and
all complete values are capped at 1 MiB of UTF-8 JSON. Transport must cap raw
bytes before parsing and use the smaller negotiated LanguageLimits limit.
A lower negotiated limit rejects a tree preview/receipt; it never truncates it.
G2 must route with `decodeLanguageResourceProposal` and
`decodeLanguageResourceAcceptance` before any legacy Struct decoder: the presence
of either format or resourceSnapshots commits routing to the tree decoder.
Missing/unknown format and malformed manifests then fail without a legacy fallback.
Legacy payloads without tree fields keep their old shapes. Outcome routing uses
format 2 exclusively for `LanguageTreeOperationOutcome`; no legacy Outcome decoder
may receive a tree receipt. Resource capability remains unavailable until G2 has
these routes and authenticated accept/status/recovery plus verified R1 drafts.

Runtime must preflight the full outcome and durable journal size before its first
checkout mutation. Repeated ownership across an ordered chain can exceed the
outcome limit despite a small proposal, so that chain must fail before prepare.
No unbounded journal allocation is authorized by the per-manifest limit.

## G2/C1 registration recipe (required before any activation)

Use dedicated methods `languages.tree.edit.decide`,
`languages.tree.operation.get` and `languages.tree.operation.recover` on the
existing authenticated Daemon connection. Their decide payload must carry
`LanguageTreeEditDecision` (acceptance plus nullable draft receipt, whole-value
1 MiB cap and accept/non-null/exact-resource-snapshot relationship);
get/recover keep the existing checkout/clientId/operationId/revision/intent
coordinates and decode `LanguageTreeOperationOutcome`. G2 must publish a distinct
negotiated tree format-2 capability, only after this group and preview delivery
are fully implemented; the exact capability registry addition is Lead-owned.
The tree preview channel must encode/decode `LanguageTreeEditProposal` before
any legacy proposal schema. Old peers without that group/capability are unavailable
for tree edits. Do not send tree payloads on the legacy methods or fall back to
regular-file RPCs after a method-not-found result.

This requires adding dedicated payload/success schemas to Effect RPC's wire group,
Client construction and C1's method-table validation *before* serialization.
Calling a routing helper inside a handler is too late if a legacy Struct already
stripped fields. G2's negative raw-boundary suite must send formatless/unknown
format/malformed/over-limit preview, acceptance and outcome bytes through the
actual codec/method table, verify manifests survive valid roundtrips, and prove
invalid trees cannot reach a legacy handler. Static schema tests here are not
proof of that future registered transport. R1 must verify the referenced durable
draft group and every dirty descendant revision; a boolean supplied by a Client
is insufficient authentication or durability evidence.

A rejection may carry null drafts and requires no new draft group or checkout
mutation. Acceptance requires a verified non-null durable tree draft receipt.

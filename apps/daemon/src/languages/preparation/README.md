# Host proposal preparation (J1 supplement)

This detached constructor has no RPC, preload, capability registration, timer or
mutation. `makeProposalPreparation(port).read(deliveryId, signal)` returns
`{proposal, documents}`. Proposal is legacy for text-only edits and format2 for
resource operations. `documents` is private Host metadata: never add it to wire
output or log text. Only the Host issues proposal ID and expiry after all checks.

`PreparationPort.delivery` must resolve an opaque reference from the independently
verified Host feature/server-delivery provenance ledger. It returns decoded
`HostDelivery {edit, fence, origin, label, encoding}`; caller request/result equality
is insufficient. `validate(id, delivery, signal)` checks immutable delivery equality,
current authenticated owner/full checkout/context/generation/document fence,
expiry, negotiated resource capability/wire constraints and abort independently.
It is called before/after initial and final snapshot paths, after document waits
and immediately before returning. Lead owns the actual provenance/auth construction.

`document(uri, delivery)` reads the actual current Host synchronized document or
null. A captured document fence requires the same version; an absent mirror may
not waive a captured version. Every open mirror requires optional
`acknowledgedBuffer(uri, delivery, document, signal)` to return independently
authenticated `{uri, version, text, draftRevision}` or explicit unavailable.
Missing/wrong URI/version/text proof refuses preparation; no buffer:null fallback
for open documents, no invented Client draft revision. Mirror and acknowledgment
are read again after filesystem waits. Closed snapshot buffer:null requires the
mirror still absent. Client inventory/promotion never rewrites Host snapshots.
Lead owns this authenticated acknowledgment construction; until bound, dirty/open
preparation remains visibly unavailable.

`acknowledgedBufferReader(() => currentStore)` adapts A0's exact
`BufferAcknowledgments.read(delivery.fence, uri)` port. The closure resolves only
the independently current principal/context/Documents/signal store; it receives
no proposal coordinates to establish authority. Missing store or acknowledgment
refuses preparation. The adapter checks abort; the constructor still compares the
returned tuple to its actual Host mirror and re-reads it after waits. Actual
authenticated record RPC, Client tuple producer and close/disconnect hooks remain
Lead-owned; this adapter creates no store, revision or wire output.

Snapshots retain initial filesystem state, including null absence for ordered
create/rename/delete chains. Complete source and overwritten destination trees use
accepted X2 no-follow snapshot/ancestor helpers with aggregate bounds. Regular text
is pinned with O_NOFOLLOW and compared to the exact manifest inode/version before
a bounded descriptor read; accepted files/version.ts sameVersion guards its hash.
The unconstrained pathname reader alone is unsafe for this authority boundary.
Valid UTF8/BOM/CRLF bytes are preserved; binary/invalid UTF8, aliases, unsafe links,
root/outside paths, partial/unreadable trees, replacements and occupied absences
fail closed. A second full snapshot/ancestor pass refuses intervening changes.

Bounds: 1024 combined snapshot paths, 128 resource paths, 1MiB per text file, 8MiB
aggregate disk+acknowledged text, and accepted tree/wire/proposal schema limits.
Encoded proposal overflow refuses output rather than truncating. Resource operation
order and nulls are preserved. Versioned documentChanges requires its exact captured
Host document fence; repeated text-document blocks and ambiguous workspace-edit
forms are visibly unsupported. Text-only ranges use actual Host mirror or disk
with negotiated UTF8/16/32 offsets and surrogate/overlap checks. Mixed resource/text
ranges require R1's ordered reconciled Client preview validation before acceptance;
this helper does not pretend the initial destination text is the renamed source.

No filesystem-wide atomicity is claimed; acceptance must repeat authority, draft
and resource snapshot checks inside the existing Host mutation locks. Tests use
owned temporary regular-file/directory fixtures and injected fake authenticated
ports only. They prove snapshots/refusal/race boundaries, not production provenance,
remote transport, native crash durability, registration or resource activation.
Original R1 renderer/runtime candidate is unchanged by this separate authorized
Daemon supplement. J1 owns shared required checks and functional proof.

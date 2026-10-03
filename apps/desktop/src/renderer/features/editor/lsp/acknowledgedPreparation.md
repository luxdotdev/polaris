# Acknowledged preparation adapter

Supply `createAcknowledgedPreparation({authority, inventory, transport})` as the
`prepare` callback to `bindEditorRefactors`. This supplements the existing
composition without constructing another controller, store or authority.

`inventory(hostKey, checkoutPath)` reads R1's current retained document inventory,
including each exact URI and buffer tuple. Use current runtime/durable ownership,
not the proposed Host snapshots. `version` and `draftRevision` remain separate;
neither is inferred from the other. R1's `openRefactorDocuments` supplies these
open tuples. Full closed/dirty inventory remains R1's acceptance-time obligation.

`transport(hostKey)` is null unless both additive preparation/acknowledgment
capabilities and the current independent Main identity are available. Reuse one
stable transport object per exact API/connection lifetime; replacing it invalidates
pending work. `editorPreparationTransport(api, hostKey)` maps only the reviewed
typed `languages.document.acknowledge` and `languages.edit.prepare` methods.
Absent handlers return explicit unavailable errors, not a fallback proposal.

The adapter acknowledges only documents in the original request fence. It checks
the no-text receipt's full context, URI, version, durable draft revision and accepted
sequence. It rereads the fenced inventory and independent authority after each
acknowledgment and after proposal preparation. Typing, revision changes, abort or
replacement refuses the result. The originating request/result/fence and raw edit
remain intact; text never appears in diagnostic errors or logs.

Lead3697 settles the other-open-document policy at request creation. Rename,
code-action and code-action resolve capture the complete bounded actual provider
sync acknowledgment, with the initiating document exactly acknowledged. The full
captured fence stays unchanged through delivery and preparation. Documents from
another context or opened/changed after delivery remain unavailable and require a
fresh intent. This adapter never adds entries to a delivered request/result fence
or substitutes a Client-created snapshot/proposal identity.

Current inventory is bounded at 1024 entries. Wire schemas/Host acknowledgment
storage enforce text and request limits; the adapter adds no timer or polling.
The actual Main/Host handler must independently authenticate the tuple and its
current synchronized mirror. Typed schema validity alone proves neither ownership
nor provenance. Only the proposal is returned by preparation; private Host
documents remain outside the wire response.

Focused tests use fake independent authority, inventory and transport. They prove
version/durable revision separation and typing/abort fences, not real Host
authentication. The RPC mapping requires J1's reviewed additive contract snapshot;
no worker shared-file replacement, compiler or heavy proof is performed.

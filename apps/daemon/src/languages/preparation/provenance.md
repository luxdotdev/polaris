# Host-issued proposal provenance

`ProposalProvenance.layer` owns bounded in-memory evidence and disposes it at Host
scope shutdown. `record(principal, proposal, validate)` is a private trusted call
only after actual Host preparation succeeds. The independent principal object is
compared by identity; Host/Client fields are additional scope checks, never proof
of authentication. Central construction supplies actual request authority.

The retained validator captures independent owner/generation/fence authority and
checks it before returning after its own asynchronous waits. It must not capture
proposal/original text or secrets. Record and verify call it repeatedly and check
exact evidence/expiry after waits; mutation owners must verify again after locks
and each asynchronous admission wait. Full strict variant encoding before JSON
fingerprinting preserves domain FileVersion instances and format2 metadata.
Resource endpoints require complete snapshots; legacy resources and malformed or
versionless tree metadata fail closed. Order, snapshots, fence, ID and expiry bind
the complete proposal hash. No caller proposal may create evidence through verify.

Identical re-record validates the original authority closure and cannot replace
it. `revoke(exactPrincipal)` permanently retires that connection object and rejects
in-flight records; central disconnect hooks must call it. No broad Client-ID
revocation is used. Shutdown disposes all records through the owning Effect Layer.

Retention is demand-driven: at most 128 proposal records, SHA256 ID keys/proposal
hashes, expiry metadata, principal reference and trusted validator only. Expiry is
bounded to 60 seconds, pruning occurs on calls, and oldest evidence is evicted
when full. Evicted proposals become unavailable; no idle timers or text/log
retention are introduced. This bound is not a total JavaScript heap guarantee.

Evidence proves only Host issuance/current ownership. It grants neither durable
Client draft completeness nor filesystem new-apply/retry permission. Unknown or
applied Host outcomes need exact authenticated status/reconciliation/receipt CAS;
Lead owns those handlers, durable receipt verification and central mounting.
Tests use decoded domain proposals and injected owner closures, including Effect
scope cleanup; no filesystem mutation, transport, provider or native UI proof.

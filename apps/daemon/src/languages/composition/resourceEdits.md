# Authenticated resource decisions

`languageResourceEditHandlers` mounts the three dedicated format-2 RPCs.
Provide `LanguageResourceEdits.layer({hostId, journalRoot})` with the same Host
`LanguageAcquisitionAuthority`, `ExecutionTrustService`, `ProposalProvenance`
and `LanguageResourceReceiptAuthority.layer` used by preparation/runtime.
The receipt layer consumes that same `LanguageBroker`, acquisition authority and provenance instance.
`journalRoot` is a canonical private Daemon directory on the checkout filesystem,
outside the checkout; it is never supplied by a Client. Lead owns mounting and
capability negotiation. Existing `LanguageCore.prepare` remains the prepare route.

Resolve challenges ask the current Client controller for its complete persisted
proposal, then verify Host-issued provenance; no new proposal/identity store is
introduced. Verify challenges require R1's private `verifyReceipt` plus
`groupStatus`, exact nonce/operation/group/preview and an unreconciled Host revision.
The handler pins local group revision across repeated challenges. Recovery binds
historical context and preview fingerprint from the existing X2 journal, the exact current
Host receipt revision and independently authenticated Client reconciliation. Old
journals lacking authority metadata remain queryable but cannot restore resources
through this route. Recovery does not use expired preview authority to replay moves.

The internal `ResourceReceipt` request travels over `languages.context.watch`
and returns over `languages.server.respond`; responses are consumed inside
ServerBridge and never sent to the provider. Each challenge has a 5-second
request-driven deadline, at most 32 pending server requests, and cancellation and
close cleanup. Wrong connection, context/generation, nonce or operation fails
closed. Renderer handlers must respond independently of pending acceptance to
avoid a circular wait. Missing response/Client controller never means approval.

X2 repeats authorization after operation/root/path locks and after durable move
intent, immediately before each native forward/reverse move. Forward checks repeat
current registered checkout/trust/provenance and durable group verification.
Recovery checks repeat current checkout/trust, journal revision and Client group
revision. A failed read/fsync or response after mutation requires status
reconciliation; unknown status never starts a new apply. Existing ordered planner,
resource containment, exact version protection and recovery model are unchanged.

The socket test uses actual authenticated connections and real temporary directory
moves, with scripted Client receipt metadata and an injected trust/provenance
fixture. It proves the exchange and coordinator composition, not production
IndexedDB/controller verification, approved provider activation or release readiness.

Historical Recover selects an already acquired, currently subscribed Broker context
for the same authenticated Host/Client/registered checkout, including a replacement
contextId/generation. Its exact live entry/bridge is pinned across the response wait.
This route permits only Recover challenges; Resolve/Verify retain exact proposal
context. `resourceRecoveryRouting.test.ts` uses the actual Broker and scripted
provider to prove repeated new-generation routing, foreign ownership/checkout
refusal, Verify refusal and unavailable-feed refusal.

Verify challenges explicitly carry `phase: prepare|moving`. Prepare validates the
complete original preview. Moving verifies current durable group and affected
dirty draft ownership after X2 legitimately changes disk paths; it must not compare
original preview disk versions again. X2 retains its exact native version guards.

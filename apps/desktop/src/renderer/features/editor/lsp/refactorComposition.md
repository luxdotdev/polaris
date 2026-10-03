# Editor-to-R1 composition

`bindEditorRefactors(ports)` binds the existing E1 preparation and prepared-edit
consumer registrations. It constructs no controller, GroupStore, identity,
snapshot, receipt or proposal ID. Dispose it before replacing the authenticated
composition. Registration disposers cannot remove a later replacement.

Required ports:

- `authority(context)` resolves an independently registered current context and
  Main identity, Host key, stable exact-lifetime token and AbortSignal. It must
  return null for absent, disconnected, superseded or unowned contexts. Looking
  up coordinates from a proposal does not authenticate them. The constructor
  checks full context equality, Host/Client identity and positive Main epoch.
- `controller(hostKey, checkoutPath)` returns R1's sole current
  `refactorFor(hostKey, canonicalCheckoutPath)` controller or null. The public
  structural port has the actual `hostKey`, `offer` and `applyAction` signatures.
  Registry replacement and authority replacement are fenced across awaits.
- `prepare(input)` is the authoritative G2/Main/Host request/result preparation
  callback, or null. Preserve the captured request/result, raw edit, origin,
  label and AbortSignal. The Host verifies independent delivery provenance,
  acknowledged unsaved text/version/durable draft revision, canonical snapshots,
  current context and capability before issuing the proposal. No renderer field
  substitutes for that authority. Missing preparation is visibly unavailable.
- `promoteTextProposal` is R1's exact text-only promoter. Already decoded format2
  proposals bypass it; legacy resources must be refused by the promoter.

Lead constructs `RefactorCoordinator(sharedDurableGroupStore, authenticatedPort,
negotiatedEncoding)`, `RefactorController(hostKey, coordinator)` and
`bindRefactors(controller, canonicalCheckoutPath)`. The GroupStore must be the
same strict durable store supplied to Editor configuration, inventory and private
verification. Reuse R1's `collectInventory`, `openRefactorDocuments`,
`checkRefactorBuffers`, `checkRefactorDrafts` and `publishRefactorBuffers` ports.
Independent authority, validation, decisions, status/recovery and private receipt
verification remain Main/Host/Client construction obligations. The R1 port must
revalidate current authority/inventory after waits and before durable mutation.
E1's admission fence cannot replace that mutation-time check.

Server proposals await `controller.offer`, always explicit preview. User rename
and code-action proposals await `controller.applyAction`; R1 chooses guarded
single-text application with undo or full preview. Existing command and rich
completion handlers remain absent, so unsupported commands/snippets receive E1's
visible unavailable feedback. Raw editable code actions use E1's existing
authoritative preparation path. There is no command execution fallback.

Focused tests use typed fake controllers and authority/preparation ports only.
They cover awaited routes, unavailability, abort, late authority replacement and
registration replacement. J1 still owns actual R1 storage, authenticated wiring,
native functional proof and required source-equivalent checks before acceptance.

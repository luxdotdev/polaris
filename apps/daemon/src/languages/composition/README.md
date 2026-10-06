# Core language composition

The default Host composition now delivers pinned Node 24.18.0, TypeScript 6.0.3
and typescript-language-server 6.0.1 on the first TypeScript discovery/acquisition.
The Client's effective `downloadLanguageToolsAutomatically` preference defaults
to true. Turning it off permits reuse of installed tools and returns the typed
`not-installed` failure when any pinned tool is missing. Manual install grants
and other catalog providers retain their independent admission policies.

Bundled TypeScript can run without Trust; configured executables still require
Trust. Discovery never chooses a Workspace SDK or probes project plugins on this
path. The pinned compiler's private preload disables plugin loading, and typing
acquisition is disabled. Rename still uses the existing acknowledged document,
proposal provenance and draft acceptance authorities. See ADR-0020 for delivery
bounds and the plugin isolation decision.

`managedDelivery.test.ts` exercises offline fixture downloads, deduplication,
checksum refusal and preference-off behavior. The opt-in
`bun test ./apps/daemon/src/languages/composition/managedLaunch.live.testing.ts`
downloads the real tools into a temporary Host and proves diagnostics, hover,
definition and rename, including refusal to execute hostile project code.
After building Desktop, `node apps/desktop/scripts/managedLanguageSmoke.ts`
exercises those features and accepts rename drafts in this repo and a fresh
`bun init` repo using isolated Daemon and Client directories.

`languageCoreHandlers(hostId)` constructs the typed ServerRpcs core handlers.
`transport/lazyLanguages.ts` mounts the default singleton Host graph on demand,
including installation, media and preparation/receipt handlers.

Provide singleton `LanguageBroker`, `ProjectDiscovery`, and
`ExecutionTrustService` services. Their registry must read the folded EventStore
and use `registeredCheckout`; knowing a path or ID never grants membership.
`languageBrokerLayer(options)` binds runtime launch to `LanguageProviderAccess`.
The port's availability delegates to I1's real Host observations and its
`resolveLaunch(facts)` must require exact approved installed-version readiness,
prerequisites and the selection barrier. Managed admission ensures the pinned
TypeScript tools before acquiring that barrier. The exported
`unavailableLayer(hostId, platform)` reports NotInstalled and catalog-derived
missing/audit-required preflight, and rejects launch with `not-installed`.
That reason stops the broker rather than scheduling crash retries.

Each RPC requires the request's existing `CurrentLanguageConnection` and
EventStore. Authentication uses the independently captured principal object,
Host identity, full registered checkout, canonical roots and current broker
ownership/generation. Canonical checks re-read the registry after filesystem
awaits. Handler results and each context feed item recheck current authority.
Same stable ClientId on a different live principal object cannot claim existing
broker contexts. Replacement requires old lifetime cleanup first.

Provide the canonical transport `LanguageConnectionLifetime` at request scope.
Acquisition attaches one memoized callback per exact principal before any broker
access. The transport must seal registrations/revoke identity synchronously and
await cleanup before disconnect emission. `LanguageBroker.disconnectAndWait`
revokes contexts immediately and waits only for that Client’s captured pending
work/process settlement under its bounded runtime contract. The callback converts
failure to a defect for the transport’s fixed cleanup warning; it deletes the
ownership gate only after successful settlement. A retained cleanup failure blocks
replacement acquisition rather than reporting successful release. Real provider
activation and integrated process-cleanup proof remain independently gated.
Request cleanup also revokes abandoned acquisitions detected after discovery.

`LanguageTrustGrantAuthority` is a separate independent grant port; its default
Layer denies. Trust scope Host/Workspace/Review Checkout are resolved from the
registry before inspection/mutation. A grant is rechecked after its await, trust
changes use the accepted durable service CAS, and changed trust fences broker
generations. The trust service must retain its own grant gate in production;
checkout/settings payloads and test-only approval callbacks are not authority.

Routes: catalog, availability read, discovery, trust get/set, context
acquire/release/restart/configure/watch, document sync, feature request/cancel,
progress cancel and server response. Discovery exposes bounded catalog provider
facts and public preflight, never private launch environment. Installer job
ownership/cancel/watch and demand-driven availability subscriptions require I1's
actual adapter ports in the separate registration layer. Lead owns document
acknowledgment/edit preparation, receipts, format and capability registration.

Focused tests use real accepted discovery/trust/broker services, a folded fake
SQLite registry, temporary files, fake connection/lifetime/grant services, and
an in-memory CAS repository. No provider process executes. They prove local
service delegation and rejection behavior, not real accounts, remote Hosts,
provider readiness, durable repository writes, or transport integration. The
separate media socket supplemental tests cover that actual local socket/Blob
composition. Shared J1 typed lint/compiler/full checks remain required.

# Detached Language Integrations Settings

U0 implements the Settings surface approved in `docs/specs/editor-language-tooling-m3.1.md`
§2 and DESIGN.md Settings. Import `LanguageSettingsPage` and its types from this folder's
`index.ts`. The module never reads `window.polaris`, registers navigation, starts an Editor,
installs an artifact, or adds a connection. U1 owns composition after I1; G2 owns remote
authority. Fake fixture permissions are not artifact approval.

## Props and state

`LanguageSettingsProps` takes one stable `adapter`, ordered `scopes`, and optional
`initialScopeKey`. Each scope has a stable key, visible label, and the accepted
`LanguageSettingsScope` value. Supply App, Language, Host, Workspace (language null), and
Workspace-language scopes with registered IDs. Preferences are Client-local even for a
Host scope. Precedence is App → Language → Host → Workspace → Workspace language, matching
C1 `LanguagePreferences.effective`. Worktree preferences target their Workspace.

`load(scope, signal)` returns `LanguageSettingsResult<LanguageSettingsSnapshot>`.
The record must belong to that exact scope; `effective` contains C1's merged settings and
origins. Missing overrides remain absent; explicit empty provider arrays and formatter
None remain explicit. Format-on-save uses the effective default, which is true. The page
preserves an unavailable selected provider/formatter rather than silently replacing it.
Formatter keys must be unique and must not use the reserved inherit/none/unlisted values.
Custom servers appear as selectable providers and formatter choices after Add/Apply.
The private Configured formatter field also accepts a full Executable selection.
Provider array order determines ownership ordering. Toggle off/on to move a provider to
the end; saving never assumes a provider implements formatting.

`save(record, signal)` replaces the entire selected scope using record.revision as the
expected revision, matching C1's CAS semantics. Merge no environment entries in the UI.
Decode the full patch before persistence; the page also decodes it before submitting.
Applied local changes block scope switching/Host actions. Refresh facts remains available
with a dirty draft. Discard explicitly adopts the latest validated record; it is unavailable
until this adapter and scope have current facts. Reset stages an empty patch and commits only through Save. JSON field Apply and
custom-server Add/Apply stage changes; Save persists them. Field validation errors are
constant strings and do not contain private values. Custom argv stays an array, never a
shell command. Environment and executable override fields use password inputs; fact rows
show environment names only. Logs must be sanitized upstream.

The page loads on mount/scope change, after acknowledged actions, and explicit refresh.
It does not poll or spawn a timer. Installation/runtime/progress values are observed
snapshots, not inferred readiness or live completion. The adapter must return current
facts, bounded and validated against the public protocol. Hosts are paged 12 at a time;
per-Host tool rows are bounded to 32 (supply integration-specific facts). Search is local.

## Actions and ownership

`act(action, signal)` returns a sanitized `LanguageSettingsResult<void>`.
Map accepted actions through C1 `LanguageApi`, with G2's registered Host/checkout authority:

| UI action | Integration responsibility |
| --- | --- |
| install / update / rollback | `languages.install` with exact tool/version and intent; await acknowledgement, then load availability. Permission/version comes from I1's authoritative action facts. |
| retry | Refresh/reprobe prerequisites and retry the explicit failed install/version; no runtime/toolchain installation. |
| cancel-install | `languages.install.cancel` with the current jobId. UI checks observed installing job correlation. |
| restart | `languages.context.restart` with the owned context; C1 validates generation/ownership. Reacquire/sync current buffers in E1, never replay unknown edits. |
| logs | Open the supplied context's bounded sanitized logs through U1's existing presentation seam; no log RPC is invented here. |
| trust | `languages.trust.set` with exact trust scope, trusted and expectedRevision; Host canonical/authenticated authority still decides. |
| recover-host | Existing reconnect, daemon upgrade, or Host Settings action. Old peers get explicit upgrade, not an empty tool list. |
| refresh | Reserved adapter action for consumers; this page calls load directly on Refresh facts. |

Host facts include accepted availability, discovery, runtime and progress types. No
`ready` boolean is synthesized from installation. `LanguageToolActions` is an explicit
permission projection, not permission inferred from a pinned version. Omit actions that
lack complete authenticated handlers/artifact review. UI additionally intersects actions
with Connected/capability/preflight/job/Host checks. Restart is suppressed during
AwaitingTrust/Starting/Unsupported. Worktrees can only use Workspace grants; a Review
Checkout needs a grant matching its exact reviewCheckoutId. These checks are presentation
guards, not substitutes for Host authorization. Never advertise G2 capabilities early.

## Cancellation and integration recipe

Every adapter call receives an AbortSignal. Scope change/unmount/replacement/cancel aborts
it. `SettingsOperations` suppresses obsolete replies even if the adapter ignores abort.
Bridge AbortSignal to C1's request lifetime/cancel API and dispose subscriptions/temporary
log resources. C1 transport owns remote deadlines. A cancelled mutation may already have
committed; UI reports unknown completion, never rolls it back optimistically or retries
automatically. Refresh current facts before another mutation. Adapter replacement and every
load/mutation/cancel immediately invalidate actionable authority. Retained snapshots are
labeled last-known; Host actions and Save stay disabled after failed/wrong-scope loads.
Load replies must decode as a LanguageSettingsRecord for the requested scope and belong to
the current adapter/load epoch; obsolete replies cannot restore authority.

Refresh retains a dirty draft and its original baseline revision. The latest confirmed
revision is shown separately. If revision or settings changed, saving and Host actions stay
blocked until explicit Discard adopts that confirmed record. No automatic rebase or replay
occurs, even when a canceled save commits later with the same contents. A successful save
acknowledgement only adopts a subsequent matching confirmed record; value comparison uses
protocol schema equivalence so object property order cannot manufacture conflicts. Generic rejected promises are rendered without
the exception text; returned failure messages must already be sanitized.

1. U1 imports this module and builds registered scope options from existing Settings data.
2. Supply C1 preference records/effective settings and syntax metadata for associations.
3. Load Host catalog/availability and D1 discovery through the existing authenticated
   optional LanguageApi. Correlate Host IDs, checkout, provider/context generation and job
   progress; return only permitted action facts from I1/T1/G2. Never derive artifact approval
   in renderer code. Include authoritative runtime errors and prerequisite reasons.
4. Implement actions in the table and route logs/recovery through existing UI owners.
5. Register the page in central Settings only in U1 after exact accepted dependency heads.
   Editor `languageSettings/index.ts` exports the reusable provider/format preference UI;
   E1/FMT retain actual editor/save integration.

## Bounded fake evidence

`bun test apps/desktop/src/renderer/features/settings/languages/model.test.ts`
checks private structured configuration, action blocking, cancellation races and trust
scope binding. `node apps/desktop/src/renderer/features/settings/languages/smoke.testing.ts
/tmp/<owned-output>` starts a loopback Vite/Electron fixture in temporary user-data/cache,
with fake Hosts only. It uses existing dependencies. Screenshots cover both themes and all
three densities, keyboard focus, narrow/long Host facts, custom configuration, error and
cancel paths. The same rendered fixture exercises replacement adapters with failed,
wrong-scope, held/late-old replies and recovery, plus dirty-save cancellation, refresh before
and after a late commit, draft retention, conflict fencing, external revisions and explicit
discard. Optional `authority-control` / `cancel-control` third arguments isolate those cases
for rejected-source controls. This is rendered detached UI evidence, not integrated production/Electron
workflow, remote-provider or budget certification. Temporary output is outside the repo.

Lead reported accepted-base subscription tables use streaming RPC successSchema wrappers.
U0 does not import those tables or cast Stream values; U1 must consume the exact E0 shared
correction during serial integration before projecting subscription items.

## U1 Settings composition

Settings → Editor → Configure language integrations mounts the accepted page through
`Integration.tsx`. `registeredScopes.ts` uses confirmed Host identities and the existing
registered Workspace, Worktree and Review Checkout model. Worktree/Review selection changes
discovery and trust; preferences still target their Workspace. Language and checkout
selection, and Back to Editor settings, are disabled while the page has a dirty draft.
Unrelated Agent Session updates do not change registry membership or restart these reads.

`adapter.ts` uses the optional `PolarisApi.languages` extension, never a second connection.
The edited scope supplies the draft and CAS revision. Independently, effective preferences
fold the selected checkout's App → language → Host → Workspace → Workspace-language records.
With no checkout, language defaults remain visible; Host/Workspace editing supplies its own
context. Every requested record must match its exact scope. Reading an unrelated scope never
silently replaces the edited record. Save confirms the full patch, exact scope and next
revision before accepting success. No private environment values enter availability or logs.

`setLanguageSettingsServices` is the settings-owned integration seam. G2/I1 supply authoritative
`permissions` and bounded sanitized `logs`; defaults omit all install/update/rollback/restart/log
permissions. Capability and preflight presentation guards intersect supplied facts. The
`languages.trust` capability gates trust changes separately. Catalog pins, artifact audit
strings and installed versions do not grant permission or synthesize runtime readiness.
Managed CLI formatter launch selections require an authoritative executable; configured
stdio/executable fields remain available without inventing managed paths.

After the exact accepted M2 handoff, `Integration.tsx` imports the production Editor
`refreshMarkdownPolicy(hostKey, workspaceId)` hook; the services seam permits a typed test override. `policy.ts` calls it after an exact typed acknowledgement, including
both external-image grant and revoke. Failure, cancellation, malformed or mismatched policy
results never refresh a preview. Policy component cleanup fences adapter/Host authority and
hook replacement. Existing Source and sanitized preview stay available without the optional
service. Source/preview view IDs and buffer authority remain Editor-owned.

`LanguageApi.request` has no renderer AbortSignal argument. Abort stops further reads and
fences replies; a submitted mutation may already have committed. Main/C1 own transport
cancellation and deadlines. The UI retains the existing explicit confirmation Refresh,
dirty baseline/revision fence and Discard behavior, and never automatically repeats a save.

`feedback.ts` accepts protocol progress/prerequisite items with actual language/Host labels,
rejects foreign Host/tool and older sequences, and bounds retained job entries to 128. E1/G2
may also supply current owned first-encounter job items. This helper does not start installs.
After accepted E0, `watch.ts` binds the existing optional typed availability/install API for
Settings. Confirmed Installing job identity/version, sequence, adapter epoch and registered Host
fence progress; replacement, reconnect, operation and unmount dispose old watches. Same-job
availability retains sequence authority. Stream end removes mutation authority until explicit
Refresh; streamed facts never acknowledge or rebase a dirty CAS draft. No polling or Stream cast. A1/I1 and G2 retain artifact/runtime/Host authorization.
No installation, activation, first-encounter production or whole-App budget is certified here.

U1's fake integrated evidence uses `integration.smoke.testing.ts` with actual SettingsPage
navigation and optional typed request/feed services. The optional `feed` argument verifies dirty
draft retention, progress/reconnect and late old callbacks; `effective` verifies
full-context overrides while saving only App defaults. Fixtures use owned temporary
Electron/Vite data and fake registered Hosts; no real account, SSH or project installation.


J1 may inject `refreshLanguageSettings(hostKey, workspaceId)` through
`setLanguageSettingsServices`. This matches E1's light typed port without importing its
unaccepted candidate. Only exact confirmed Settings CAS or trust acknowledgements invoke it.
App/language changes refresh registered Editor contexts; Host/Workspace changes refresh matching
confirmed Host identities and Workspace ids, deduplicating Worktrees. Failed, foreign, superseded
or cancelled replies never refresh. Trust acknowledgement must match scope, next revision and
requested trust value. The hook does not grant permissions, install tools or infer readiness.

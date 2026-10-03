# Normal Host language tooling recovery

The installed Daemon at `0.0.0-dev.1068.66217a5` reports the Polaris Workspace
(`ws_42c21d3f-df34-4543-9fbe-5d769f922f72`) as untrusted, revision 0.
Discovery returns `awaiting-trust`. The normal Desktop App profile has no
language settings file; the playable demo's configuration is isolated.

Settings previously required successful discovery to expose the trust button.
Settings now reads and validates scoped trust independently, retaining an explicit
trust action when prerequisites or discovery are unavailable. Foreign, failed,
stale and cancelled facts still cannot authorize grants. Loading Settings never
grants trust. The Editor now distinguishes awaiting trust from other failures.

Rebuild and restart the Desktop App. No Daemon change is required for this fix.
Open Settings → Editor → Configure language integrations. Select TypeScript and
the Polaris checkout, then choose **Trust this checkout** if you want its project
code to execute. Trust is an explicit user decision.

For TypeScript on this checkout, use a custom stdio server with these existing
local files. Select the Workspace language scope so these paths stay scoped to
this checkout. Add the server, enable its provider, and Save language settings.

| Custom server field | Value |
| --- | --- |
| ID | `typescript-language-server` |
| Executable | `/Users/lucasdoell/.nvm/versions/node/v24.18.0/bin/node` |
| Arguments | `["/Users/lucasdoell/code/polaris/.polaris-dev/m31-v1/tools/typescript-language-server/lib/cli.mjs", "--stdio"]` |
| Environment | `{}` |
| Root markers | `["package.json"]` |
| Working directory | Leave empty |
| File patterns | `["*.ts", "*.tsx", "*.js", "*.jsx"]` |
| Document language ID | `typescript` |
| Initialization options | `{"tsserver":{"path":"/Users/lucasdoell/code/polaris/node_modules/.bun/typescript@6.0.3/node_modules/typescript/lib/tsserver.js"}}` |
| Settings | `{}` |

The root TypeScript 7 dependency has no `lib/tsserver.js`; the explicit existing
TypeScript 6 path avoids that separate provider startup failure. These paths
were checked on this Host. They have not been applied to its normal profile or
launched against its untrusted Workspace. Managed downloads remain unavailable
in this v1.

Validation: full typecheck and lint passed; full test task succeeded with nine
cached packages and 1,298 fresh Desktop tests, zero failures and 4,295 assertions.
The first sandboxed test attempt failed two socket-dependent Daemon fixture
tests; the socket-capable rerun passed. The Desktop source build passed. Scoped
trust regressions cover failed prerequisites/discovery, foreign/failed trust
reads, explicit grant behavior and rendered enabled/disabled trust buttons.

The first fix missed the page's watch lifecycle: it subscribed to an availability
feed with no observed tools. The installed Daemon rejects that feed with
`unsupported-capability`, invalidating the entire Settings snapshot and disabling
trust. Settings now skips tooling subscriptions when no tools were observed;
the scoped trust observation remains usable. A regression exercises load, watch
and explicit grant together. Full typecheck, lint and test tasks pass, including
1,299 fresh Desktop tests and 4,299 assertions. The initial full App bundle attempt
hit a sandbox denial in the unchanged Daemon frecency selftest; renderer and main
source builds were validated separately.

# Host Settings

The Daemon owns the settings for work on its Host (ADR 0120, ENG-1023). Client appearance
stays on each device. `registry.ts` is the catalogue; each entry is an Effect Schema annotated
with `setting(schema, { description, default, userOnly? })`. Validation and discovery use that same Schema.

<!-- Host Settings RPCs and descriptors from packages/protocol/src/settings.ts -->

- `settings.list { scope? }` returns Host and connected Client entries with their `scope`, key, description, JSON Schema document (`type`), default,
  current value and whether the Host has an explicit value (`overridden`). The Schema document
  includes allowed values, refinements and nested field definitions.
- `settings.describe { key, scope? }` returns the description, Schema document and default.
- `settings.get { key, scope? }` returns the descriptor and current value.
- `settings.set { key, value, scope?, ifUnset? }` validates before saving. `ifUnset` imports a legacy
  Client value atomically without replacing a Host choice. Unknown keys return `NotFound`;
  invalid values and storage failures return `SettingsError`.

The `settings` capability announces these RPCs. Reads use the read Grant. An omitted read/write
scope selects Host Settings; list without a scope includes both scopes, or only Host Settings
when no Client is connected. Explicit Client reads/writes fail immediately without a Client.
`polaris settings list|describe|get|set` and the compact MCP `settings` tool come from the same
command annotations. For example: `polaris settings get theme --scope client`.

Agent writes check the descriptor's `userOnly` before asking the Engine for a change settings
Grant Approval. A remembered settings Grant cannot bypass it. `sessions.startLimit` and
`traces.workspaces` (which includes forwarding URLs) are user-only Host Settings. Client model
preferences, prediction endpoints, update Channel and automatic updates are user-only too;
the Desktop App independently rejects every relay request for these entries. Keybinding
overrides remain agent-writable. Legacy trace-policy writes are also refused to agents.
Extensions retain their existing Client-only settings write gate.

<!-- Setting families and migration files from registry.ts -->

| Keys | Legacy file |
| --- | --- |
| `reviewer.*` | `reviewer-settings.json` |
| `constellation.*` | `constellation-settings.json` |
| `traces.workspaces` | `trace-settings.json` |
| `attachments.*` | `attachment-settings.json` |
| `visuals.level` | `visuals-settings.json` |
| `sessions.autoArchive.afterDays` | `auto-archive-settings.json` |
| `sessions.idleCompaction.*` | `idle-compaction-settings.json` |
| `sessions.suggestedReplies.*` | `suggested-replies.json` |
| `sessions.startLimit` | Engine event log; user-only budget, default 5 |
| `sessions.defaults`, `sessions.defaults.<harness>.model/effort/permissionMode` | Desktop `settings.json` |

On first access, `index.ts` reads the old files once and atomically creates
`~/.polaris/host-settings.json` with mode 0600 in a private directory. Valid fields become
setting values; absent fields use their defaults. The `legacy` section retains original JSON,
including unknown fields, or original text for malformed JSON. The old files remain intact
and are never reread once the new store exists. A failed write leaves the previous store intact.
Legacy per-area APIs delegate to this store. Generic changes re-arm the existing auto-archive,
idle-compaction and suggested-reply services; trace changes invalidate active trace policies.

The Desktop App imports its legacy `sessionDefaults` on each Host's first connection, with
`ifUnset`, then reads and changes that Host's values. Another Client and later reconnects cannot
overwrite a Host choice with the old Desktop file. The aggregate key and individual Harness
field keys are views of one saved value. Harnesses from a newer build remain discoverable.

`bun test apps/daemon/src/settings` checks the metadata contract, all migrations, validation,
legacy delegation and RPC outcomes. `checkRegistry` also refuses missing descriptions or
invalid defaults when the module loads. Trace policy invalidation is tested beside TraceSettings;
the Desktop migration test calls the real settings RPC handlers for two independent Hosts.

`sessions.startLimit` is an Engine-backed setting: its event is authoritative, and the generic
file setter refuses it. The settings RPC exposes the current value and checks user access before
changing it. Session overrides use `SetSessionStartLimit`; lowering either limit below current
spending is refused. Agent session starts read `sessions.defaults` afresh on their own Host.

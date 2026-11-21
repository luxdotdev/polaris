# Host Settings

The Daemon owns the settings for work on its Host (ADR 0120, ENG-1023). Client appearance
stays on each device. `registry.ts` is the catalogue; each entry is an Effect Schema annotated
with `setting(schema, { description, default })`. Validation and discovery use that same Schema.

<!-- Host Settings RPCs and descriptors from packages/protocol/src/settings.ts -->

- `settings.list {}` returns each key, description, JSON Schema document (`type`), default,
  current value and whether the Host has an explicit value (`overridden`). The Schema document
  includes allowed values, refinements and nested field definitions.
- `settings.describe { key }` returns the description, Schema document and default.
- `settings.get { key }` returns the descriptor and current value.
- `settings.set { key, value, ifUnset? }` validates before saving. `ifUnset` imports a legacy
  Client value atomically without replacing a Host choice. Unknown keys return `NotFound`;
  invalid values and storage failures return `SettingsError`.

The `settings` capability announces these RPCs. Reads use the read Grant; set is user-only
until the change-settings Grant integration. Each is annotated as a generated command, so
`polaris settings list|describe|get|set` comes from the same RPC definitions. S3 adds the
combined Host/Client command scope and MCP tool.

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

# attachments/

`AttachmentStore` (from `services.ts`), `AttachmentMaintenance` (the Settings operations), and the `attachments.stage` handler (ENG-176, ENG-180).

## Design

- The layout under `paths().staging`: `<session>/<attachment id>/<safe name>`, with a `.meta.json` beside it. Attachments staged before their Agent Session exists go under `_pending/<workspace>/<attachment id>/`. Files are written `0600`, in `0700` directories.
- `safeFileName` keeps only the base name, replaces control and reserved characters, strips leading dots, and caps the name at 120 characters, keeping the extension. The original name is returned as `Attachment.name`.
- `get(ids)` leaves out attachments that were already cleaned up.
- **Cleanup policy** (`AttachmentSettings`, persisted to `~/.polaris/attachment-settings.json`): a default policy, overridable per Workspace.
  - `on-archive` (the default): `onSessionArchived(sessionId)` deletes that session's attachments. `_pending` attachments are never archived, so the sweeper deletes them after `PENDING_MAX_AGE_DAYS` (7).
  - `after-days` with N: the sweeper deletes attachments staged more than N days ago.
  - `never`: attachments are kept until "clear now".
- The sweeper runs hourly while the layer is alive. `AttachmentMaintenance.sweep` runs it on demand.
- **Settings operations** (additive; not in `services.ts`): `settings`, `setSettings`, `usage` (bytes and files staged on this Host), and `clearNow({ workspaceId? })`, which returns what it removed.
- **Handlers**: `AttachmentRpcsLive` takes the Client's blob from `BlobChannel.take(blobId)` and stages it. It needs `AttachmentStore` (`AttachmentStoreLive()` provides both services) and `BlobChannel`.

## Known gaps / TODOs

- Nothing moves `_pending` attachments into the session directory once the session exists. The engine can re-stage them or leave them in place, since `hostPath` stays valid.
- Settings live in a JSON file. The Settings workstream may want them in the event store instead.
- There are no size limits or quotas yet.

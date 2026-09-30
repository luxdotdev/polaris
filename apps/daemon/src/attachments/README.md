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
- **Settings operations** (additive; not in `services.ts`): `settings`, `setSettings`, `usage` (bytes and files staged on this Host), `usageByWorkspace`, and `clearNow({ workspaceId? })`, which returns what it removed. The policy schema is the protocol's `AttachmentCleanup`.
- **Settings RPCs** (capability `attachments.settings`): `attachments.settings` (the settings plus usage, in total and per Workspace), `attachments.setSettings`, and `attachments.clear({ workspaceId })` (null clears everything), all in `AttachmentRpcs.ts`. Settings → Attachments in the Desktop App uses them.
- **Streaming**: `stage` takes the bytes whole or as a stream. `AttachmentRpcsLive` passes `BlobChannel.takeStream(blobId)`, so an upload is written to `<attachment id>/.partial` chunk by chunk as it arrives and renamed into place when complete: the Daemon holds a few 256 KiB chunks, whatever the size. A failed or oversized upload removes its directory. `maxBytes` (default `MAX_ATTACHMENT_BYTES`, 512 MiB, the Wire's own per-blob limit) is checked as the chunks arrive.
- **Handlers**: `AttachmentRpcsLive` needs `AttachmentStore` and `AttachmentMaintenance` (`AttachmentStoreLive()` provides both) and `BlobChannel`.

## Known gaps / TODOs

- Nothing moves `_pending` attachments into the session directory once the session exists. The engine can re-stage them or leave them in place, since `hostPath` stays valid.
- Settings live in a JSON file. The Settings workstream may want them in the event store instead.
- There is a per-attachment size limit but no quota.

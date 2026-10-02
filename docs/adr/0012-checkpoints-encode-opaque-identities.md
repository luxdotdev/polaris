# Checkpoints encode opaque identities

Git refs cannot contain colons, spaces or several other characters. Constellation
Worker Session and Turn IDs are opaque command-derived identities and contain
colons. Changing those IDs would break journal links and existing Sessions.

Checkpoint lookup preserves the original `refs/polaris/checkpoints/<session>/<turn>/<label>`
path for existing Git-safe identities. Unsafe identities use
`refs/polaris/checkpoints-v2/<session-hex>/t/<turn-hex>/<label>`. Hex encodes UTF-16
code units without losing identity, and splits into components of at most 128
characters. The `t` separator cannot occur in hex. The separate namespace avoids
collisions with legacy IDs that already contain percent escapes or encoded text.
Turn IDs with slashes also use the new namespace so parsing remains reversible.

Capture, diff and fork lookup share the same ref function. Pruning enumerates
both namespaces and decodes original Session and Turn identities before applying
its existing retention policy. Existing refs need no migration; new checkpoints
for an existing unsafe Worker succeed. Snapshots whose original `update-ref`
failed remain absent: this change does not infer or repair historical checkpoint
commits in user repositories.

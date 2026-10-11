# Clean open views outside a provider's synchronized inventory

Remote repository Python rename reached Host preparation, then the renderer
reported "Text snapshot changed before preview." The file's text, size, hash and
mtime matched exactly. Its clean Editor view had a local buffer tuple, while the
provider had no synchronized document for that URI and prepared a disk snapshot.

For a URI absent from the captured provider fence, a clean open view may match a
Host disk-only snapshot only when its current text equals the non-null snapshot
text and every disk version field still matches. Dirty views, missing files,
synchronized documents without acknowledgments, and changed disk facts refuse.
Acknowledged snapshots still require the exact original buffer tuple.

The complete local buffer tuple, document version and draft revision remain in
the original inventory. Acceptance rereads and compares that full inventory
before persistence and again afterward; even a same-text local revision change
refuses before Host mutation. No Host buffer acknowledgment is manufactured,
no proposal/fence is extended, and no deadline or stale-edit check is removed.

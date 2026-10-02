# Language refactors create Editor drafts

Accepted multi-file language refactors apply text edits as persistent Editor
drafts, including unopened files, with coordinated undo instead of implicitly
saving them. File create/rename/delete operations are previewed too, but affect
disk through a version-checked recoverable coordinator. This preserves the
user's save boundary while acknowledging that resource operations cannot live
only in a text buffer; recovery and undo must not overwrite intervening work.

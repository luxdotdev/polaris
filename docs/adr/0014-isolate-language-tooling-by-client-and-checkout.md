# Isolate language tooling by Client and checkout

Each Client and checkout has isolated language-server document state, while
tabs in the same Client can share tooling for the same project. Sharing one
document state across Clients or checkouts would mix independent unsaved drafts
or different revisions of the code. We accept additional server memory in
exchange for correct diagnostics and edits, while reusing installed tools on
the same Host.

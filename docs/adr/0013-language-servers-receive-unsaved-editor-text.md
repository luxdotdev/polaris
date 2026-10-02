# Language servers receive unsaved Editor text on the file's Host

Language servers run through the Daemon on the Host that holds the files, and
receive synchronized unsaved Editor text without writing those edits to disk.
The Desktop App remains the owner of persistent drafts, while Agent Sessions
continue reading saved files. This keeps diagnostics and completion aligned
with what the user is typing without requiring autosave or a local filesystem
mirror of remote Workspaces.

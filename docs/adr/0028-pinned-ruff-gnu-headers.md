# Decode the pinned Ruff Linux archive's GNU regular headers

The Pi's checksum-verified Ruff 0.16.10 Linux archive uses GNU tar headers.
The decoder previously admitted that format only for selected Node files;
Ruff installation failed before any language server process was spawned.

Only the pinned upstream Ruff decoder opts into GNU regular file/directory
headers. All archive checksums, path, numeric, size, padding, trailer, permission
and audit checks remain. Links, sparse files and other extensions are rejected;
GNU long-name records remain exclusive to selected Node extraction. General
artifact decoding retains its existing POSIX-only default. No code was copied.
Format reference: https://www.gnu.org/software/tar/manual/html_node/gnu.html.

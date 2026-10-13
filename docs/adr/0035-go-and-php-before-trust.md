# Go and PHP before Trust

gopls has no mode that runs nothing from the project: loading packages runs
`go list`, which reads `go.mod`, `go.work`, `GOFLAGS` and the toolchain line
(and may switch toolchains). So gopls starts only after Trust. Polaris never
downloads or builds it: gopls and the Go toolchain are Prerequisites (a new
catalog `distribution: "developer"` with no artifacts), found by presence in
fixed directories (`GOBIN`, the first `GOPATH`'s `bin`, `~/go/bin`,
`/usr/local/go/bin` and the usual ones) without running them. The pill gives
`go install golang.org/x/tools/gopls@latest`, and Check again finds it. The
launch re-checks both files' identity and puts the toolchain's directory first
on `PATH`. Before Trust the Go file's status says "needs Trust", and observing
it needs no Trust (nothing runs). Formatting is gopls's, which is gofmt.

Phpactor is the pinned upstream PHAR (MIT, with the PHAR's Composer licence
retained), run with the Host's PHP 8.2+, which is a Prerequisite. Before Trust
it runs with options that override every config file (Phpactor merges
initialization options last): no Composer autoloader or class maps, no
`.phpactor.json` (its own trust store is pointed at a path that can't exist,
and `PHPACTOR_UNCONDITIONAL_TRUST` is cleared), no trust prompt or
auto-config, and none of the optional extensions that run project tools
(phpstan, psalm, php-cs-fixer, mago, phpcs, behat, symfony, prophecy).

Phpactor's diagnostics and code actions run in a subprocess, and its indexer
can fork workers; those subprocesses build their config from files and
environment, not from the initialization options, so they would load
Composer's files. Before Trust all three stay in the server's process
(`diagnostic_outsource`, `code_action_outsource` off, one index worker), and
`GIT_DIR` points at the same dead path so no `git` run reads the project's
config. The live test proves this with Composer files that write a marker when
loaded: the marker stays absent before Trust and appears after.

After Trust Phpactor runs normally with project config and Composer, and
enables its php-cs-fixer extension when the project has
`vendor/bin/php-cs-fixer`, so format on save uses it. Without it Phpactor has
no formatter. Trust is part of the discovery fingerprint, so the server
restarts in the new mode; the Desktop App re-discovers open files on a Trust
change, which is what brings a Trust-blocked gopls up.

Phpactor checks a file when it opens and when it changes, not when its first
index finishes, so a diagnostic that needs an indexed class appears after the
first edit.

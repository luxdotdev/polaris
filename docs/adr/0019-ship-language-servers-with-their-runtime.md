---
status: accepted
supersedes: part of ADR-0016 (runtimes, sources, updates)
---

# Ship language servers with their runtime, from pinned upstream releases

ADR 0016 left server runtimes to the developer, so no TypeScript or Python server worked without hand configuration, and M3.1 stalled building servers from source. Polaris now downloads each server's own pinned upstream release (npm tarball or GitHub release, verified by sha256) into private Host directories, together with a private Node that the npm-based servers run on, silently on first use. It never builds servers from source. Pinned versions move only with a Polaris release.

Interpreters and project toolchains (Python, Rust, Go, Java) stay the developer's: they are Prerequisites, reported and never installed. Managed servers run without Trust; running a Workspace's own code (its TypeScript, plugins, formatters) needs Trust.

## Considered options

- **Building from source** gives provenance, but rust-analyzer, Ruff and ShellCheck could not be built reliably, and no shipping editor does it.
- **Bundling every server in the installer** bloats the app with languages most people never open.
- **Requiring Node on the Host** fails on a fresh Host such as the Pi, and Bun is not a reliable stand-in for `tsserver`.

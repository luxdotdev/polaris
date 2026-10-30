# External binaries the Daemon installs

Each tool here follows the managed model server's pattern (`prediction/managed`, ADR 0049): a pin file with the upstream release, its commit and every platform's asset (URL, size, SHA-256 from the release's own digests), and `downloadFile` to fetch it size-bounded into `.part`, check the hash and rename it into place. It lives under `~/.polaris/tools/<tool>/<version>/`; a new pin installs beside the old version, then deletes it.

Nothing installs at start or on a timer: the first caller that needs the tool installs it (one install at a time, retried on the next call after a failure). The idle Daemon pays nothing.

- `agentBrowser/`: vercel-labs/agent-browser (Apache-2.0), the Browser's MCP server (ADR 0092). Bare binaries for darwin arm64/x64, Linux arm64/x64 (glibc and musl) and Windows x64; no Chrome is downloaded, since it only attaches over CDP. It is not copied into Polaris, so ATTRIBUTION.md has no entry.

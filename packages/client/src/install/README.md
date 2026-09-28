# Client: installing and upgrading the Daemon over SSH

`@polaris/client/install` makes sure a Host runs a Daemon the Client can talk to. The Desktop App bundles all three Daemon builds (`apps/daemon/dist/`, see `apps/daemon/src/service/README.md`), so nothing is ever downloaded on the Host.

```ts
const builds = loadBuilds(bundledDistDir)
const result = yield* ensureDaemon(alias, builds, { trigger: "user", approvedSha256 }).pipe(
  Effect.provide(Ssh.layer),
)
```

| File | What |
|---|---|
| `Ssh.ts` | `Ssh` service: one non-interactive command over the system `ssh` (`-T -o BatchMode=yes -o ConnectTimeout=15 -- <alias>`), with optional stdin streamed from a local file. ssh's own failures (exit 255) become `SshError` with a `failure` of `host-key`, `auth`, `unreachable`, `spawn` or `unknown`. `needsAttention` is true for the first two. Remote commands are wrapped in `sh -c '…'`, so the user's login shell does not matter. |
| `builds.ts` | `loadBuilds(distDir)` reads `manifest.json`. Also `platformFromUname`, `compareVersions`. |
| `plan.ts` | `planInstall(probe, builds, options)`, a pure function; every branch is unit-tested. |
| `remote.ts` | `probeHost`, `applyPlan`, `ensureDaemon`. |

## Flow

1. **Probe** (one round trip): `uname -s`, `uname -m`, and `~/.polaris/bin/current/polaris version`.
2. **Plan**:
   - `Unsupported` / `MissingBuild`: the Host is not a platform we ship, or its build is not bundled.
   - `UpToDate`, or `InstalledNewer`: the Host is ahead of this Client. It is never downgraded; capability negotiation decides.
   - `NeedsApproval`: no Daemon yet. It carries the **platform, version and SHA-256** for the one-time approval, shown inline on the Host as Needs Attention. A **background reconnect never installs**, even for an approved SHA (`reason: "background"`).
   - `Install`: no Daemon, the user asked, and this build's SHA-256 is in `approvedSha256`.
   - `Upgrade`: an older Daemon is installed. Approval was given at first install, so no new approval is needed, and it may run on a background reconnect.
3. **Apply**: upload every file of the build into `~/.polaris/upload-<random>/` through ssh stdin (`cat > f.part && chmod && mv`). Check each file's SHA-256 on the Host (`sha256sum`, or `shasum -a 256` on macOS), then run:
   - Install: `<upload>/polaris install --json`
   - Upgrade: `~/.polaris/bin/current/polaris upgrade <upload>/polaris --json` (execve hand-off, same PID; Harnesses keep running)

   The upload directory is always removed afterwards. The JSON line the Daemon prints is returned in `applied.report`.

## Tests

`plan.test.ts` covers the pure decisions. `remote.test.ts` runs the whole flow against a fake `Ssh` that executes each remote command in a local `sh` with `HOME` set to a temporary "Host", so the real probe, upload and SHA-check scripts run. A shell stand-in plays `polaris install/upgrade`. It covers approval gating, install, idempotence, upgrade, a corrupted upload, and ssh failure classification.

## Known gaps / TODO

- Storing approvals (`approvedSha256` per Host) belongs to the Desktop App.
- Each file is a separate ssh invocation. Use ControlMaster (the connection workstream's multiplexed session) to avoid repeated handshakes.
- Uploads are not resumable; a dropped connection re-uploads from the start.
- `probeHost` trusts `uname`. A Linux Host with musl libc is reported as `linux-x64` / `linux-arm64`, but our builds need glibc.

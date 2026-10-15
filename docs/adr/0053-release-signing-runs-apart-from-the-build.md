---
status: accepted
fixes: release code and its dependencies ran with Apple signing credentials and release write access
---

# Release signing runs apart from the build

## Context

`release.yml` was one macOS job. It checked out the tag, ran `bun install` (every
dependency's install scripts), built and packaged with the repository's own code, and,
in the same job, imported the Developer ID certificate into an unlocked keychain,
held the App Store Connect key, and created the Release with a `contents: write`
token. Four actions were selected by movable major tags (`@v4`). Anything that ran in
that job (a dependency, a tag's build code, a retargeted action) could copy the
signing identity and the notary key, or publish its own bytes under the project's
signature. A Codex Security audit reported both paths.

## Decision

The release is a chain of jobs, each with only the authority it needs, handing off
artifacts whose SHA-256 the next job checks against the digest its producer reported:

| Job | Runs | Secrets | Token |
|---|---|---|---|
| `metadata` | `tooling/release/metadata.py` | whether each is set (`secrets.X != ''`), never a value | read |
| `build` | the tag's code: install, package unsigned, smoke-test | none | read |
| `sign` | `tooling/release/sign.py app` from the default branch | Apple | read |
| `dmg` | the tag's code: check the signed app, build the DMG around it | none | read |
| `sign-dmg` | `tooling/release/sign.py dmg` from the default branch | Apple | read |
| `windows` | the tag's code: package unsigned | none | read |
| `publish` | `gh` only: verify hand-offs, draft the Release | none | write |

`sign` and `dmg` run only for a signed release; a prerelease without credentials goes
`build` → `windows` → `publish`, as before.

The signer uses only the Python standard library and Apple's tools (`security`,
`codesign`, `notarytool`, `stapler`, `ditto`, `hdiutil`), and executes nothing from
the artifacts. It is checked out from the default branch, so a tag cannot change what
handles the credentials; the credentials live in a temporary keychain and files that
are deleted before it exits. Signing the Daemon changes its bytes, so the signer also
re-records them in the manifests, the darwin-arm64 Release archive (the same ustar
layout as `archive.ts`) and `SHA256SUMS`, before it seals the app. The DMG is built
in an unprivileged job between the two signing jobs, because building it needs
`dmgbuild` and its dependencies.

Every external action is pinned to a full commit SHA with its version in a comment.
`tooling/release/workflows.test.ts` fails if an action is unpinned, if any job but
`publish` can write, or if a job holding a secret value runs anything but checkout,
artifact transfer and the signer.

## Consequences

- Signing runs the default branch's signer on the tag's build; when they diverge (a
  release cut from a branch that changes the signer), the default branch wins.
- The signer is only as reviewed as the default branch: branch protection, tag rules
  and required reviewers on the `release` environment are owner settings.
- `package.ts` keeps its own signing path for local signed builds; the workflow no
  longer uses it.
- Three more macOS jobs for a signed release, each re-downloading the app.
- The workflow still only drafts the Release; a maintainer publishes it.

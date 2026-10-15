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
artifacts whose SHA-256 the next job checks against the digest its producer reported.
The signing jobs download a hand-off by the artifact ID its upload step recorded as a
job output, so no later upload under the same name can stand in for it:

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

A digest only proves the signer got what the build uploaded, and the build ran the
tag's code, so the signer treats each hand-off as hostile. It copies the file into a
directory it creates (the run fails if that directory exists), checks the copy's
SHA-256 itself, and unpacks the tar with its own checks: every entry is a relative
path without `.` or `..` under `apps/daemon/dist` or the app, and is a directory, a
regular file or a symlink; hard links, devices and FIFOs are refused, files are
created exclusively and never through a symlink, and set-ID bits are dropped. A
symlink may only sit inside the app's `Contents/Frameworks`, with a relative target
that stays there, and must resolve (`Path.resolve(strict=True)`) inside it: the
links a framework's `Versions/Current` layout needs, and nothing that reaches out.
Manifest names (files, binaries, archives) must be plain file names. The signed
bundle, the Daemon dist for Windows, the release assets and their digests are
written only into the signer's directory; the workflow uploads them and reports the
digests from there. `tooling/release/test_sign.py` (run by CI's check job) crafts
hand-offs with traversal names, outside symlinks and Frameworks links that leave
the bundle.

Every external action is pinned to a full commit SHA with its version in a comment.
`tooling/release/workflows.test.ts` fails if an action is unpinned, if any job but
`publish` can write, or if a job holding a secret value runs anything but checkout,
artifact transfer and the signer, or if such a job downloads a hand-off by name or
handles one with shell tools instead of the signer.

## Consequences

- Signing runs the default branch's signer on the tag's build; when they diverge (a
  release cut from a branch that changes the signer), the default branch wins.
- The signer is only as reviewed as the default branch: branch protection, tag rules
  and required reviewers on the `release` environment are owner settings.
- `package.ts` keeps its own signing path for local signed builds; the workflow no
  longer uses it.
- Three more macOS jobs for a signed release, each re-downloading the app.
- The workflow still only drafts the Release; a maintainer publishes it.

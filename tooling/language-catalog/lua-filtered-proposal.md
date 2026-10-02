# Lua 3.19.1 filtered packaging contract

Lead preliminary review authorized implementation of this concrete variant. It did not approve an artifact or grant release readiness. Every Lua artifact remains audit-pending; complete retained legal/vendor/runtime closure is still required before A1 approval. Published Linux static compiler/runtime evidence remains separately blocked.

## Distribution and installation contract

`Artifact.packaging` pins `filter: lua-core-v1`, the unchanged original download integrity, a safe relative manifest path, its SHA-256, the resulting distribution integrity, and `disableThirdPartyDiscovery: true`. All four offered platform downloads have exact retained-file manifests under `packaging/`. The filter removes only `meta/3rd` and its descendants, retaining `meta/template` and every other upstream file, including legal notices. Bundled optional third-party annotation packs are excluded. Developer-owned libraries remain configurable under trust through explicit library paths; automatic third-party discovery is disabled by default.

`package-lua.py` verifies original archive bytes before filtering, rejects unsafe paths, links, special files and duplicate paths, and preserves retained file bytes and modes. The post-filter root is SHA-256 of UTF-8 JSON containing file records ordered by UTF-8 path bytes, each with properties in the order `path`, `integrity`, `size`, `mode`, and no whitespace or trailing newline. Timestamps, owners and directory enumeration order do not affect that identity.

Installers must call `verifyPackaging` in `apps/daemon/src/languages/catalog/packaging.ts` with the original verified download, pinned manifest, parsed archive entries, actual staged entries, and actual third-party discovery setting. A logically filtered archive list alone is insufficient: staged optional annotations, omitted/altered templates or notices, changed modes, extra files and enabled discovery fail verification. Staging does not authorize activation; the ordinary artifact audit and A1 record must also pass. I1 owns production installer wiring and must enforce this contract before recording installed state. No production installer or readiness bypass is claimed by K2.

## Measured features and scope

The original probe measured document `str` → global completion label `string`. It was not proof of full standard-library tooling, and its Project root included fixture server sources. `lua-filtered-proposal.json` preserves that limited evidence without expanding its scope.

The corrected `probe-lua-capabilities.py` uses a separate temporary Project whose root contains only its own document. The server sources, locale and generated metadata lie outside that root. Actual Darwin arm64 replies in `lua-filtered-capabilities.json` demonstrate template-backed `string.sub` member completion, typed member hover, a syntax diagnostic on the test document, formatting edits, initialization, shutdown and bounded process-group reaping. All 527 staged retained file identities/modes match the pinned Darwin arm64 post-filter root. This certifies those probes only, not full feature parity or other platforms.

The first member probes expected label `sub`; the actual server labels it `sub(s, i, j)` with insertion text `sub`. Those assertions failed and were corrected without changing the server. The successful assertion checks the real member insertion and signature. Earlier null-completion probes also raced metadata initialization; the corrected probe uses a bounded deadline.

## Reproduction

```
python3 tooling/language-catalog/package-lua.py --root /tmp/k2-lua-packaging-fresh --fixture /tmp/k1-catalog --stage-artifact lua-language-server-3.19.1-darwin-arm64.tar.gz
python3 tooling/language-catalog/probe-lua-capabilities.py --server /tmp/k2-lua-packaging-fresh/filtered/lua-language-server-3.19.1-darwin-arm64.tar.gz --root /tmp/k2-lua-features-fresh --output /tmp/k2-lua-features.json
```

Only verified existing fixtures or bounded pinned release downloads are used. No Host toolchain/system libraries are installed and no user/project environment is modified. The configuration flags and metadata behavior were checked through Context7 against [LuaLS Getting Started](https://github.com/LuaLS/lua-language-server/wiki/Getting-Started).

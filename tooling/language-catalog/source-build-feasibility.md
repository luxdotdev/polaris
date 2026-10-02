# Native source-build feasibility proposal

This is a proposal, not a build receipt or license approval. Original published
binary descriptors remain blocked. Read-only existing-tool checks are recorded in
`source-build-prerequisites.json`. No compiler, target, runtime, SDK, system library
or image was installed. Build recipes/metadata/legal files alone were inspected.

## First bounded fixture

Recommend **rust-analyzer on Darwin arm64** first. Source commit
`03fcb77246f2568adb0e9b2fa60d19c6cc1686f4`, archive SHA-256
`34edfc1e72dfc0808f70823230019a7fe1f3133c50705a1b780e0855d40c3a42`,
and Cargo.lock SHA-256
`6497b191fc31008c70214d1360893919a519095ec1b90c9ffaa667e7476d46a6`
are captured. All 332 frozen registry archives are already present; the source
lock has no Git resolver inputs. The existing compiler is Rust 1.98.0 at commit
`88d9e12ae178fab0fb5cc050a94da85685d449ea`, Cargo 1.98.0, Apple Clang
21.0.0, and the installed macOS SDK 27.0 (SDKSettings.json SHA-256
`7b93ad7e534cc4b31c6a4e39d19b5e0288acf2168c2649479a796d1cb51939fb`). The source declares Rust 1.98 minimum.
Use the direct compiler-home binaries, not rustup shims, to prevent toolchain
selection/download. Existing rust-src is present; no other target is inferred.

Run the small proposal validator (hashing only; no extraction or compiler build):

```sh
python3 tooling/language-catalog/plan-rust-analyzer-build.py \
  --root /tmp/k3-ra-source-build-proposed \
  --source-cache /tmp/k2-audit/legal-cache \
  --crates /tmp/k1-catalog/crates \
  --compiler-home /Users/lucasdoell/.rustup/toolchains/stable-aarch64-apple-darwin \
  --output /tmp/k3-ra-source-build-plan.json
```

The generated plan gives exact argv/environment, staging conditions and acceptance.
Approved fixture direction: **two jobs, 20 minutes, at least 6 GiB free at
start, stopping at 3 GiB aggregate new fixture bytes or below 2 GiB free**. The
4 GiB limit is the maximum successful-attempt budget, not an absolute filesystem
ceiling. Source, vendor, Cargo home, target, temporary files, logs and an 8 KiB
external receipt reserve all count. Measurement targets 10 Hz; filesystem traversal
and scheduling can delay a sample. Each extracted/build file is capped at 256 MiB;
build logs retain at most 1 MiB and metadata at most 16 MiB. These are stop limits,
not measured build estimates. Fail rather than fetch missing packages, expand the bound, or change the
lock/features. Stage source/vendor bytes only after Lead review. Capture a complete
staged tree, Cargo dependency/features plan, compiler/sysroot/SDK digests, link map,
`otool -L` and unresolved-symbol/runtime metadata, output hash, legal/source delivery,
then actual isolated LSP capability/cleanup probes. A proposal is not any of those
receipts. A second build must assess actual byte reproducibility.

The binary is a **new artifact** with a new reviewed build identity. `rust-analyzer`
alone does not certify the optional proc-macro server; capture and test that helper
and its compiler compatibility separately before claiming parity. Developer Cargo,
Rust standard-library sources and project build trust remain prerequisites. No
default/provider swap follows automatically from a successful build.

## Per-tool and target matrix

| Tool / target | Immutable input and resolver | Existing prerequisite / build proposal | Runtime + delivery / capability difference | Resource bound |
| --- | --- | --- | --- | --- |
| rust-analyzer / Darwin arm64 | Source/lock above, all 332 checksum-pinned crates; default features recorded before build | Existing Rust/Cargo 1.98.0 + Apple linker/SDK; private vendor config; `cargo build --frozen --offline --release -j 2 --target aarch64-apple-darwin -p rust-analyzer --bin rust-analyzer` | Own compiler/std/libunwind/link-map roots; dynamic system libraries are Host prerequisites. Include helper/legal/source roots and actual LSP probes before parity. | Proposed 20 min / 4 GiB output / 6 GiB free; no build yet |
| rust-analyzer / Darwin x64 | Same source/crates; separate target sysroot/SDK roots required | Existing Host has arm64 Rust std; x64 Rust std not recorded installed. Fixture requires a developer-owned existing x64 target/compiler/SDK; no target installation. | New target output/linkage/legal roots and real x64 capability fixture required; arm64 result cannot certify it. | Not measured; propose same initial stop limits only after exact target inputs exist |
| rust-analyzer / Linux GNU arm64+x64 and musl x64 | Same source/crates; exact Linux target compiler/sysroot/linker/libc inputs are not captured | Propose an explicitly authorized existing native Linux developer toolchain fixture; GNU/musl compiler, libc, loader/libgcc identity must be pinned. No SSH/container/toolchain probe or pull. | Distinct source-build records for each target; declare loader/runtime requirements from actual output. No portability inferred from target name. | No runnable Host identified; budget/commands finalize only with exact existing prerequisites |
| Ruff / Darwin arm64 | Source `3265ed1f944c98bb4c04d632fbefb1257cdb583d`, archive `646895bfc295414071d68a8fe0c467a7e9eb704e559b1919aec9928c77dd11d0`; lock `afea7ed1bf25dc2dcc7fffe0551dd85abc164e09a675e561fa402d01df0f4bdf`; 505 cached crates, no Git dependencies | Manifest minimum Rust 1.97; release recipe pins 1.99.0, absent here. Source-build using existing 1.98 is a distinct alternative requiring A1 assessment. Proposed direct `cargo build --frozen --offline --release -j 2 --target aarch64-apple-darwin -p ruff --bin ruff` after vendor staging. | Pin actual compiler/std/libunwind inputs, output/link map and notice/source delivery; probe Ruff LSP diagnostics + formatting + CLI. Original binary is unchanged and blocked. | Proposed 20 min / 4 GiB outputs / 6 GiB free; compiler choice needs review |
| Ruff / Darwin x64 + Linux GNU/musl arm64+x64 | Same frozen source/crates plus separate target compiler/sysroot roots | Existing per-target native fixtures required; do not install 1.99 or cross targets. Linux toolchain inputs are not available on this authorized Host. | Every target needs its own actual runtime/build and editing/formatting evidence; local Darwin cannot certify Linux or musl static scope. | Not measured; no heavy fixture authorized |
| Lua / Darwin arm64 | Source `d11e79dc2745b5bfe654490eff234c6be2f6606f`, archive `c9893e9f53b1df599a40a1ccea615f22b60fb504330dcf49e2c849f37f10eb94`; exact luamake/bee/lpeglabel/EmmyLua/json Gitlinks in native-source-closure | Existing C11/C++17 Apple Clang/SDK; make present, Ninja absent. Must first audit pinned luamake bootstrap/Ninja provenance and generated metadata recipe. Preserve code-format inclusion and Lua55 runtime; no optional formatter removal. | Rebuild retained generated annotations from exact source templates; new linkage/runtime/legal/file-filter roots. Probe template completion, typed hover, Project diagnostics and formatting. | Proposed 10 min / 1 GiB output after complete bootstrap inputs; not currently runnable |
| Lua / Darwin x64 + Linux arm64+x64 | Same source/Gitlinks; make.lua sets Linux static CRT; Linux recipe optionally uses Zig glibc 2.17 and libc++ | Existing x64 SDK/compiler or native Linux C/C++/Ninja/bootstrap fixture required. No Zig/GCC/sysroot installation. Pin actual chosen compiler and static C++/C runtime inputs before build. | Keep all approved features and lua-core-v1/discovery restrictions; actual Linux static runtime membership/legal/source roots needed. No inherited binary label or file-byte match certifies it. | No authorized Linux fixture; bounds finalize with exact existing inputs |
| JDT / all existing offered targets | Core source `08eafe6ff60c7159ef88571d47b6a9ef82fef94e`, archive `4d51f4ba585b455b4c65a4d333ae14e1d5dac6789e88ed7623c63135cb865361`; Tycho 5.0.2. Exact 114 top-level + 78 nested/46 native provenance roots retained | Maven/Ant absent. Core manifest requires JavaSE-21; exact existing JDK21+ and Maven distribution/version must be pinned with frozen private Maven/plugin/p2 repositories. Root recipe has moving p2/resolver inputs; freezing complete target/plugin closure precedes `mvn -o -Dmaven.repo.local=<private> verify`. No wrapper/tool downloads. | Per-native-target source/linkage/notice/source delivery, full Java completion/diagnostic/refactor/format fixtures. JAR identity/parent source alone is insufficient. Snapshot agent recipe pins compiler3.13.0/jar3.4.2/shade3.6.0 + ASM9.10.1; actual shaded output proof is separate. | Not runnable here; estimated 4–8 GiB / 30–60 min is unmeasured planning only; requires separate resource review |

ShellCheck follows the distinct developer-prerequisite proposal in K3.md, with
managed Bash LS/shfmt retained and original managed artifacts blocked/evaluated.
No absence recheck of GHC/Cabal/Stack was performed.

## Acceptance and ownership

K3 owns fixture input closure and resulting records. Lead reviews the smallest
heavy fixture/resource bound before execution; A1 owns exact release/legal review
and any product/default/prerequisite decision. Missing targets remain explicit K3
work requiring identified existing prerequisites, not an unowned upstream-response
follow-up. No proposal changes a catalog release gate, manages runtimes or claims
source-built readiness. All four original offered native tools remain blocked.

## Runner guard evidence

`bounded-build.py` and `stage-rust-analyzer-build.py` implement the private root,
verified archive staging, exact compiler commit/digest drift checks, frozen vendor
configuration, allowlisted Cargo environment and execution sandbox. The sandbox
denies network access and writes outside the canonical fixture root. No HOME,
home or CODEX_HOME variable is overridden. TERM then KILL cleanup has bounded
waits and checks that the process group is gone on success and fault paths.

Eight small synthetic tests passed in 1.494 seconds on this Host, including a
TERM-ignoring forked descendant, per-file/aggregate/free-space/deadline faults,
archive traversal/escaping-link rejection, internal legal-link preservation,
compiler drift and sandbox denial of a local bind/external write. These fixtures
are synthetic and are not source-build execution evidence. The final aggregate
fixture measured 98,304 bytes at a 64,000-byte threshold: 34,304 bytes overshoot,
exit -15 and processGroupReaped=true. The preceding seven-test run measured
81,920 bytes (17,920 overshoot). Both are expected failed limit attempts. Neither
proves an absolute cap; the real attempt fails on any measured 4 GiB breach or
free-space-floor breach and must not resume. No real source extraction/build or
capability probe has run. Estimated staging input is 47,679,835 compressed crate
bytes plus the pinned source archive; expanded/build size remains unmeasured.


Link-map preparation now uses `record-rust-link.py`: unique bounded invocation
receipts/maps, direct driver digest pinning and an actual artifact output-hash
match are required. SDKSettings identity is retained separately from the missing
complete referenced SDK/native-input closure. The separately provided helper
identity is drift-checked; its capability and legal delivery remain unproved.
Nine synthetic guard tests passed in1.818 seconds; no real link/build ran.

# Rust and Lua before Trust

rust-analyzer assumes all code is trusted: loading a Cargo workspace runs
`cargo metadata` (which reads `.cargo/config.toml` and `rust-toolchain.toml`),
build scripts, proc-macros and `cargo check`, and a `rust-analyzer.toml` in the
workspace can replace those commands.

Before Trust, Polaris launches the pinned rust-analyzer with build scripts,
proc-macros and check on save off, and with `linkedProjects` naming a
`rust-project.json` it writes outside the Workspace (so no workspace
`rust-analyzer.toml` applies). Discovery reads the crates from `Cargo.toml`
text: the package's library and binaries, path dependencies inside the checkout,
and workspace members without globs. The Host's default toolchain is found by
reading rustup's settings files (or a packaged `rustc`), never by running a
rustup proxy; `CARGO`, `RUSTC` and `RUSTFMT` name its binaries and `PATH` is its
`bin`, so the project's `rust-toolchain.toml` and cargo config are never read.
Analysis is local: no registry dependencies, no build-script output, no macro
expansion. The configuration answer repeats the launch options, because
rust-analyzer replaces its initialization options with it. `cargo.autoreload`
stays on: turning it off stops rust-analyzer loading the linked project.

After Trust the launch is rust-analyzer's normal configuration with the Host's
`PATH`, so rustup applies the project's toolchain. Trust changes the discovery
fingerprint, so the server restarts in the new mode.

lua-language-server loads a `.luarc` `runtime.plugin` (Lua code) only when the
client says it trusts the workspace (`trustByClient`) or the user accepts its
prompt; Polaris passes Trust as `trustByClient` and declines the prompt. Its
logs and generated metadata go to a private directory beside the install
(`--logpath`, `--metapath`). Discovery asks for Trust only when a `.luarc` names a
plugin.

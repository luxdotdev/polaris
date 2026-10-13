# Installer build

`bun run --cwd apps/desktop package --release` produces both
`out/dist/Polaris-<version>-arm64-mac.zip` and
`out/dist/Polaris-<version>-arm64.dmg`. To rebuild just the DMG from the existing
`out/dist/Polaris-darwin-arm64/Polaris.app`, run
`bun apps/desktop/scripts/dmg.ts` from the repository root.

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) on the macOS
runner before packaging. `uv run --locked --script build_dmg.py` uses the committed
script lockfile, including wheel hashes. It needs Python 3.10 or newer, macOS's
`hdiutil`, `tiffutil`, and the Xcode Command Line Tools (`SetFile`). The build
writes `.DS_Store` directly with [dmgbuild](https://dmgbuild.readthedocs.io/en/latest/);
it needs no Finder, AppleScript, display, or logged-in GUI session.

Build-only dependency audit: dmgbuild 1.6.7, ds-store 1.3.3 and mac-alias 2.2.3
are all MIT licensed (verified from their installed licence files). None is
bundled into Polaris, and no upstream implementation is copied. The repository's
`bun run licenses:check` audits shipped JavaScript/native dependencies separately.

The background comes from DESIGN.md's accepted Installer recipe:
`uv run --with numpy --with pillow design/scripts/gen_dmg.py`. The committed
`design/assets/dmg/background.png` and `background@2x.png` share whole-pixel
330×200 scene cells. dmgbuild combines them with `tiffutil -cathidpicheck` into the
hidden Retina TIFF on the image. The HFS+ image uses UDZO/zlib compression and
contains the app, an Applications symlink, the app's volume icon, and Finder's
660×400 layout with the specified 100pt icons and 12pt labels.

Finder's saved window bounds include its 32pt title bar, so the image specifies
660×432 window bounds for 660×400 content. A fresh image honours the toolbar and
sidebar settings. Navigating to an already mounted volume from an existing
window can retain that window's chrome. Finder's global path/status bar settings
may override the image's preferences; "Show all filename extensions" exposes
`Polaris.app` despite its hidden-extension flag. These are native Finder limits.

Real mounted verification on macOS 27.0 found black icon labels on the night image
even with dark Finder chrome; Paper I1 had assumed white labels in dark appearance.
The user chose the dawn background (Paper I3/I4) for everyone after this finding.
The generator now draws that scene with seed 12, meadow flowers and the dawn
cabin, with a neutral ink arrow. The black labels are legible in both Finder
appearances. No label colour is baked into the background; Finder draws the labels.

With the same complete credentials consumed by `release.ts`, packaging verifies
the already signed and stapled app, builds the image without modifying it, signs
the DMG with Developer ID and a secure timestamp, waits for `notarytool` to return
`Accepted`, staples and validates the DMG ticket, then verifies the image checksum.
Only then is the staged DMG moved to its stable output name. Failures clean the
staging directory and leave any previous verified output intact. Without
credentials the image is built and checksum-verified unsigned; partial credentials
fail before building. Real Apple-service validation awaits ENG-253 credentials.

## Windows (experimental, unsigned)

`bun run --cwd apps/desktop package --windows --reuse-daemon` builds win32 x64
and arm64 with the existing pixel icon and Windows executable metadata, then
runs `electron-winstaller` 5.4.4 (MIT) for each. Installer generation needs
Windows, or both Mono and Wine on macOS/Linux. `--no-installer` allows local
cross-builds without those tools. Regenerate `Polaris.ico` with
`bun apps/desktop/scripts/packaging/icon.ts`: its six PNG entries (16, 32, 48,
64, 128, 256) are the existing natively drawn Linux PNGs, without resampling.

Windows always returns `unsigned` at `resolveSigning`; Apple credentials are
ignored. Authenticode can be introduced at this seam later. No native Windows
Daemon is built. `--windows` requires `--reuse-daemon` and an existing verified
manifest; it never builds, signs or rewrites Daemon files. Release versions must
match. The macOS release job archives its final Daemon dist after signing;
the Windows job restores that tarball and verifies the copied bytes again.

Under `out/dist/squirrel-<arch>/`:

- `Polaris-<version>-<arch>-win-Setup.exe`
- `Polaris-<arch>-win-<NuGet version>-full.nupkg`
- `RELEASES`, and its GitHub asset alias `Polaris-<version>-<arch>-win-RELEASES`

NuGet removes prerelease dots (`1.2.3-rc.1` becomes `1.2.3-rc1`). Package IDs
include the architecture so feeds cannot offer an incompatible executable.
Only full packages are published; delta generation is disabled until a
previous-release artifact contract exists. Each RELEASES hash/size is checked
against the generated nupkg before upload. Bun skips the dependency's install
script, so the installer seam copies its vendor tools into a temporary folder
and selects the build Host's 7-Zip binaries there. It adds no trusted dependency.
The standard licence gate passes; the build-only package declares MIT.

Windows packages enter through a small Squirrel bootstrap. Maintenance launches
create/remove shortcuts before importing the Client runtime, keeping cold startup
within Squirrel's hook deadline. Temporary vendor cleanup retries transient
Windows file locks for a bounded interval.

The Squirrel launcher's version scan ignores `app-0.0.0`. Windows development
packaging maps the repository's placeholder `0.0.0` to `0.0.1-dev`; a release
at `0.0.0` is rejected. Other release and prerelease versions are unchanged.

`windows-smoke.ps1 -Installer <Setup.exe> -Arch <x64|arm64>` installs on a fresh
Windows account/throwaway VM and waits for an actual Polaris window handle.
It uses isolated settings with the local Host and automatic update checks off.
It refuses to overwrite an existing installation, stops only that installation's
processes, and removes only its temporary settings. It leaves the installation
and shortcuts in place. The release job runs it for x64 on `windows-latest`;
arm64 installation/launch still requires the owner's Windows arm64 VM.

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
The user chose a dawn background for everyone after this finding. This pipeline
retains the accepted night assets for this Attempt; `dmg-dawn-design` and
`dmg-dawn-build` own the replacement artwork. No label colour is baked into the
background; Finder draws the labels.

With the same complete credentials consumed by `release.ts`, packaging verifies
the already signed and stapled app, builds the image without modifying it, signs
the DMG with Developer ID and a secure timestamp, waits for `notarytool` to return
`Accepted`, staples and validates the DMG ticket, then verifies the image checksum.
Only then is the staged DMG moved to its stable output name. Failures clean the
staging directory and leave any previous verified output intact. Without
credentials the image is built and checksum-verified unsigned; partial credentials
fail before building. Real Apple-service validation awaits ENG-253 credentials.

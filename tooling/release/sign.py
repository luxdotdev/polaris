"""Sign, notarise and staple the macOS release outputs for release.yml.

The only release code that sees Apple credentials (docs/adr/0053). release.yml runs
it from the default branch on artifacts built without credentials, and it uses only
the standard library and Apple's tools: no dependencies, no repository build code.

  sign.py app --dist DIST --app Polaris.app --out DIR --entitlements DIR --version V
      signs the darwin-arm64 Daemon, records its new bytes in the manifests and its
      Release archive, signs the app from the inside out, notarises and staples it,
      and writes the update ZIP to DIR.
  sign.py dmg --dmg Polaris-V-arm64.dmg
      signs, notarises and staples the installer image.

Credentials come from the environment: MACOS_CERT_P12 (base64), MACOS_CERT_PASSWORD,
APPLE_API_KEY (the .p8 contents), APPLE_API_KEY_ID, APPLE_API_ISSUER, APPLE_TEAM_ID
and optionally MACOS_SIGNING_IDENTITY. They live in a temporary keychain and files
that are deleted before the script exits. --ad-hoc signs with "-" and skips
notarisation instead: a local dry run that needs no credentials.
"""

from __future__ import annotations

import argparse
import base64
import contextlib
import gzip
import hashlib
import json
import os
import plistlib
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

PLATFORM = "darwin-arm64"
DAEMON_ENTITLEMENTS = {"polaris": "daemon.plist", "betterleaks": "betterleaks.plist"}
APP_ENTITLEMENTS = "electron.plist"
REQUIRED = (
    "MACOS_CERT_P12",
    "MACOS_CERT_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_TEAM_ID",
)
MACHO = {bytes.fromhex(m) for m in ("feedface", "feedfacf", "cefaedfe", "cffaedfe")}
FAT = {bytes.fromhex(m) for m in ("cafebabe", "cafebabf")}
BLOCK = 512
# packages/client/src/install/archive.ts: the same fixed mtime keeps archives reproducible.
MTIME = 1_767_225_600


@dataclass(frozen=True)
class Notary:
    key: str
    key_id: str
    issuer: str


@dataclass(frozen=True)
class Signer:
    identity: str
    keychain: str | None
    timestamp: bool
    notary: Notary | None


def run(cmd: list, check: bool = True) -> str:
    result = subprocess.run([str(part) for part in cmd], capture_output=True, text=True)
    if check and result.returncode != 0:
        # Only the tool and subcommand: arguments may hold a password.
        raise SystemExit(f"{' '.join(map(str, cmd[:2]))} failed: {result.stderr.strip()}")
    return result.stdout


def read_json(path: Path):
    return json.loads(path.read_text())


def write_json(path: Path, value) -> None:
    # The JSON.stringify(value, null, 2) layout packaging writes.
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def facts(path: Path) -> dict:
    data = path.read_bytes()
    return {"sha256": hashlib.sha256(data).hexdigest(), "size": len(data)}


def select_identity(output: str, team: str, wanted: str | None) -> str:
    found = re.findall(r'\b([0-9A-Fa-f]{40}) "(Developer ID Application: [^"\n]+)"', output)
    matches = [
        name
        for sha, name in found
        if name.endswith(f"({team})") and (not wanted or wanted in (name, sha))
    ]
    if len(set(matches)) != 1:
        raise SystemExit(
            "expected one valid Developer ID Application identity for APPLE_TEAM_ID; "
            "select with MACOS_SIGNING_IDENTITY"
        )
    return matches[0]


@contextlib.contextmanager
def credentials(env):
    missing = [name for name in REQUIRED if not env.get(name, "").strip()]
    if missing:
        raise SystemExit("missing signing secrets: " + ", ".join(missing))
    directory = Path(tempfile.mkdtemp(prefix="polaris-signing-"))
    keychain = directory / "release.keychain-db"
    original = shlex.split(run(["security", "list-keychains", "-d", "user"]))
    password = secrets.token_hex(32)
    print(f"::add-mask::{password}", flush=True)
    try:
        certificate = directory / "certificate.p12"
        certificate.write_bytes(base64.b64decode(env["MACOS_CERT_P12"]))
        key = directory / "AuthKey.p8"
        key.write_text(env["APPLE_API_KEY"])
        run(["security", "create-keychain", "-p", password, keychain])
        run(["security", "set-keychain-settings", "-lut", "21600", keychain])
        run(["security", "unlock-keychain", "-p", password, keychain])
        run(["security", "import", certificate, "-P", env["MACOS_CERT_PASSWORD"], "-k",
             keychain, "-t", "cert", "-f", "pkcs12", "-T", "/usr/bin/codesign", "-T", "/usr/bin/security"])
        certificate.unlink()
        run(["security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:",
             "-s", "-k", password, keychain])
        run(["security", "list-keychains", "-d", "user", "-s", keychain, *original])
        identities = run(["security", "find-identity", "-v", "-p", "codesigning", keychain])
        identity = select_identity(
            identities, env["APPLE_TEAM_ID"], env.get("MACOS_SIGNING_IDENTITY", "").strip()
        )
        notary = Notary(str(key), env["APPLE_API_KEY_ID"], env["APPLE_API_ISSUER"])
        yield Signer(identity, str(keychain), True, notary)
    finally:
        run(["security", "list-keychains", "-d", "user", "-s", *original], check=False)
        if keychain.exists():
            run(["security", "delete-keychain", keychain], check=False)
        shutil.rmtree(directory, ignore_errors=True)


def sign(signer: Signer, path: Path, entitlements: Path | None, runtime: bool = True) -> None:
    cmd = ["codesign", "--force", "--sign", signer.identity]
    if signer.keychain:
        cmd += ["--keychain", signer.keychain]
    if signer.timestamp:
        cmd.append("--timestamp")
    if runtime:
        cmd += ["--options", "runtime"]
    if entitlements is not None:
        cmd += ["--entitlements", entitlements]
    run([*cmd, path])
    run(["codesign", "--verify", "--strict", path])


def notarize(signer: Signer, path: Path, submission: Path) -> None:
    if signer.notary is None:
        return
    notary = signer.notary
    output = run(["xcrun", "notarytool", "submit", submission, "--key", notary.key,
                  "--key-id", notary.key_id, "--issuer", notary.issuer, "--wait",
                  "--output-format", "json"], check=False)
    try:
        result = json.loads(output)
    except json.JSONDecodeError:
        raise SystemExit(f"notarytool returned no result for {path.name}") from None
    if result.get("status") != "Accepted":
        raise SystemExit(
            f"{path.name} notarisation {result.get('status')}: submission {result.get('id')} "
            "(xcrun notarytool log <id> has Apple's reasons)"
        )
    run(["xcrun", "stapler", "staple", path])
    run(["xcrun", "stapler", "validate", path])


def tar_header(name: str, mode: int, size: int) -> bytes:
    header = bytearray(BLOCK)

    def put(offset: int, value: bytes) -> None:
        header[offset:offset + len(value)] = value

    def octal(offset: int, length: int, value: int) -> None:
        put(offset, f"{value:0{length - 1}o}".encode() + b"\0")

    put(0, name.encode())
    octal(100, 8, mode)
    octal(108, 8, 0)
    octal(116, 8, 0)
    octal(124, 12, size)
    octal(136, 12, MTIME)
    header[156] = 0x30
    put(257, b"ustar\x0000")
    checksum = sum(0x20 if 148 <= i < 156 else byte for i, byte in enumerate(header))
    put(148, f"{checksum:06o}".encode() + b"\0 ")
    return bytes(header)


def pack_archive(entries: list) -> bytes:
    """The Release archive format of archive.ts: a gzipped ustar of plain files."""
    tar = bytearray()
    for name, mode, data in entries:
        if not name or len(name) >= 100 or re.search(r"[/\\\0]", name) or name in (".", ".."):
            raise SystemExit(f'archive entry name "{name}" is not plain')
        tar += tar_header(name, mode, len(data)) + data
        tar += bytes(-len(data) % BLOCK)
    tar += bytes(2 * BLOCK)
    return gzip.compress(bytes(tar), compresslevel=9, mtime=0)


def rewrite_archive(dist: Path, manifest: dict) -> None:
    build = manifest["platforms"][PLATFORM]
    archive = build.get("archive")
    if archive is None:
        raise SystemExit(f"{PLATFORM}: the release manifest records no archive")
    names = [build["binary"], *(name for name in build["files"] if name != build["binary"])]
    entries = [
        (name,
         0o755 if name == build["binary"] or build["files"][name].get("executable") else 0o644,
         (dist / PLATFORM / name).read_bytes())
        for name in names
    ]
    path = dist / "release" / archive["name"]
    path.write_bytes(pack_archive(entries))
    archive.update(facts(path))
    sums = [f"{b['archive']['sha256']}  {b['archive']['name']}" for b in manifest["platforms"].values()]
    (dist / "release" / f"polaris-daemon-{manifest['version']}-SHA256SUMS").write_text(
        "\n".join(sums) + "\n"
    )


def sign_daemon(signer: Signer, dist: Path, entitlements: Path, version: str) -> dict:
    manifest = read_json(dist / "manifest.json")
    if manifest["version"] != version:
        raise SystemExit(f"Daemon manifest version {manifest['version']} is not {version}")
    build = manifest["platforms"][PLATFORM]
    if build["binary"] != "polaris" or any(name not in build["files"] for name in DAEMON_ENTITLEMENTS):
        raise SystemExit(f"missing {PLATFORM} polaris or betterleaks")
    for name, plist in DAEMON_ENTITLEMENTS.items():
        binary = dist / PLATFORM / name
        entry = build["files"][name]
        if facts(binary) != {"sha256": entry["sha256"], "size": entry["size"]}:
            raise SystemExit(f"{PLATFORM}/{name}: bytes differ from the Daemon manifest")
        sign(signer, binary, entitlements / plist)
        entry.update(facts(binary))
    build["sha256"] = build["files"]["polaris"]["sha256"]
    rewrite_archive(dist, manifest)
    write_json(dist / "manifest.json", manifest)
    return manifest


def restage_daemon(app: Path, dist: Path, manifest: dict) -> None:
    staged = app / "Contents/Resources/daemon"
    bundled = read_json(staged / "manifest.json").get("bundled")
    if bundled != [PLATFORM]:
        raise SystemExit(f"the app must bundle only {PLATFORM}'s Daemon, found {bundled}")
    for name in DAEMON_ENTITLEMENTS:
        shutil.copy2(dist / PLATFORM / name, staged / PLATFORM / name)
    write_json(staged / "manifest.json", {**manifest, "bundled": bundled})


def is_macho(path: Path) -> bool:
    with path.open("rb") as file:
        head = file.read(8)
    # Java class files share the fat magic; their version field is far above any arch count.
    return head[:4] in MACHO or (head[:4] in FAT and int.from_bytes(head[4:8], "big") < 32)


def is_main_executable(path: Path) -> bool:
    """A bundle's own executable, which codesign signs when it signs the bundle."""
    grandparent = path.parent.parent
    if path.parent.name == "MacOS" and grandparent.name == "Contents" and grandparent.parent.suffix == ".app":
        info = grandparent / "Info.plist"
        return info.exists() and plistlib.loads(info.read_bytes()).get("CFBundleExecutable") == path.name
    # Name.framework/Versions/<version>/Name
    return grandparent.name == "Versions" and grandparent.parent.suffix == ".framework" and (
        path.name == grandparent.parent.stem
    )


def nested_code(app: Path) -> list:
    """Mach-O files and bundles inside the app, deepest first, without the signed Daemon."""
    daemon = app / "Contents/Resources/daemon"
    found = []
    for root, dirs, files in os.walk(app):
        here = Path(root)
        dirs[:] = sorted(d for d in dirs if here / d != daemon and not (here / d).is_symlink())
        found += [here / d for d in dirs if d.endswith((".app", ".framework"))]
        for name in sorted(files):
            path = here / name
            if not path.is_symlink() and is_macho(path) and not is_main_executable(path):
                found.append(path)
    return sorted(found, key=lambda path: len(path.parts), reverse=True)


def sign_app(signer: Signer, app: Path, entitlements: Path) -> None:
    for path in nested_code(app):
        sign(signer, path, entitlements)
    sign(signer, app, entitlements)
    run(["codesign", "--verify", "--deep", "--strict", app])


def release_app(signer: Signer, args) -> None:
    app = args.app.resolve()
    if app.name != "Polaris.app":
        raise SystemExit("expected a Polaris.app bundle")
    manifest = sign_daemon(signer, args.dist, args.entitlements, args.version)
    restage_daemon(app, args.dist, manifest)
    sign_app(signer, app, args.entitlements / APP_ENTITLEMENTS)
    with tempfile.TemporaryDirectory() as scratch:
        submission = Path(scratch) / "Polaris.zip"
        if signer.notary is not None:
            run(["ditto", "-c", "-k", "--keepParent", app, submission])
        notarize(signer, app, submission)
    args.out.mkdir(parents=True, exist_ok=True)
    update = args.out / f"Polaris-{args.version}-arm64-mac.zip"
    update.unlink(missing_ok=True)
    run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", app, update])
    print(f"signed {app}\narchived {update}")


def release_dmg(signer: Signer, args) -> None:
    sign(signer, args.dmg, None, runtime=False)
    notarize(signer, args.dmg, args.dmg)
    run(["hdiutil", "verify", args.dmg])
    print(f"signed {args.dmg}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--ad-hoc", action="store_true", help="sign with '-' and skip notarisation")
    commands = parser.add_subparsers(dest="command", required=True)
    app = commands.add_parser("app")
    app.add_argument("--dist", type=Path, required=True)
    app.add_argument("--app", type=Path, required=True)
    app.add_argument("--out", type=Path, required=True)
    app.add_argument("--entitlements", type=Path, required=True)
    app.add_argument("--version", required=True)
    dmg = commands.add_parser("dmg")
    dmg.add_argument("--dmg", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise SystemExit("signing requires macOS")
    session = (
        contextlib.nullcontext(Signer("-", None, False, None))
        if args.ad_hoc
        else credentials(os.environ)
    )
    with session as signer:
        (release_app if args.command == "app" else release_dmg)(signer, args)


if __name__ == "__main__":
    main()

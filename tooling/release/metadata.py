"""Validate a release tag, the package versions and the signing policy for release.yml.

Reads RELEASE_TAG and the six signing secrets from the environment, checks
apps/desktop and apps/daemon (under --root, default the working directory) carry
the tag's version, and appends version, nuget_version, prerelease and signed to
$GITHUB_OUTPUT. Runs before dependencies are installed, so it uses only the stdlib.
"""

import argparse
import json
import os
import re
from pathlib import Path

NUMBER = r"(?:0|[1-9][0-9]*)"
TAG = re.compile(rf"v({NUMBER}\.{NUMBER}\.{NUMBER})(?:-(alpha|beta|rc)\.({NUMBER}))?")
SIGNING_SECRETS = (
    "MACOS_CERT_P12",
    "MACOS_CERT_PASSWORD",
    "APPLE_API_KEY",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_TEAM_ID",
)


def metadata(tag: str, root: Path, env: dict) -> dict:
    match = TAG.fullmatch(tag)
    if not match:
        raise SystemExit(
            "Expected v<major>.<minor>.<patch> or v<major>.<minor>.<patch>-<alpha|beta|rc>.N"
        )
    version = tag[1:]
    for package in ("desktop", "daemon"):
        actual = json.loads((root / "apps" / package / "package.json").read_text())["version"]
        if actual != version:
            raise SystemExit(f"Tag/version mismatch: {package} is {actual}, tag is {version}")

    present = [name for name in SIGNING_SECRETS if env.get(name, "").strip()]
    if present and len(present) != len(SIGNING_SECRETS):
        missing = ", ".join(name for name in SIGNING_SECRETS if name not in present)
        raise SystemExit("Incomplete signing secrets: missing " + missing)
    prerelease = match.group(2) is not None
    signed = bool(present)
    if not prerelease and not signed:
        raise SystemExit("Stable tags require all six signing secrets")

    # Squirrel's NuGet versions drop the prerelease dot (electron-winstaller convertVersion).
    nuget = f"{match.group(1)}-{match.group(2)}{match.group(3)}" if prerelease else version
    return {
        "version": version,
        "nuget_version": nuget,
        "prerelease": str(prerelease).lower(),
        "signed": str(signed).lower(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    values = metadata(os.environ["RELEASE_TAG"], args.root, dict(os.environ))
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))


if __name__ == "__main__":
    main()

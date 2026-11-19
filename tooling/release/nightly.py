"""Plan, version and prune the nightly builds of main for nightly-build.yml (docs/adr/0057).

  plan   picks the newest main commit whose required lane (the CI check) passed, and the
         nightly version for it: vX.Y.Z-nightly.YYYYMMDD, X.Y.Z the next patch after main's
         version (or main's own version while it is a prerelease). It skips when the newest
         nightly Release was built from that commit, or when today's nightly is published.
         Writes skip, reason, sha, version and tag to $GITHUB_OUTPUT.
  bump   sets the Desktop App's and the Daemon's version (and bun.lock's record of them).
  prune  keeps the newest --keep nightly Releases and deletes the other nightly Releases and
         tags, except --current (a failed run's tag stays until the next run).

GitHub is reached only through the gh CLI (GH_REPO names the repository). Stdlib only.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
from pathlib import Path

NUMBER = r"(?:0|[1-9][0-9]*)"
VERSION = re.compile(rf"({NUMBER})\.({NUMBER})\.({NUMBER})(?:-([0-9A-Za-z.-]+))?")
NIGHTLY_TAG = re.compile(rf"v({NUMBER})\.({NUMBER})\.({NUMBER})-nightly\.([0-9]{{8}})")
REQUIRED_CHECK = "CI"
SEARCHED_COMMITS = 30
RELEASES_PER_PAGE = 100


def gh_json(*args: str):
    result = subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def nightly_key(tag: str):
    match = NIGHTLY_TAG.fullmatch(tag)
    return tuple(int(part) for part in match.groups()) if match else None


def nightly_releases(repo: str) -> list:
    """Published nightly Releases, newest version first."""
    releases = gh_json(f"repos/{repo}/releases?per_page={RELEASES_PER_PAGE}")
    nightlies = [r for r in releases if not r["draft"] and nightly_key(r["tag_name"])]
    return sorted(nightlies, key=lambda r: nightly_key(r["tag_name"]), reverse=True)


def required_lane_passed(repo: str, sha: str) -> bool:
    runs = gh_json(f"repos/{repo}/commits/{sha}/check-runs?check_name={REQUIRED_CHECK}&filter=latest")
    return any(
        run["name"] == REQUIRED_CHECK
        and run["app"]["slug"] == "github-actions"
        and run["conclusion"] == "success"
        for run in runs["check_runs"]
    )


def newest_green_commit(repo: str) -> str | None:
    for commit in gh_json(f"repos/{repo}/commits?sha=main&per_page={SEARCHED_COMMITS}"):
        if required_lane_passed(repo, commit["sha"]):
            return commit["sha"]
    return None


def nightly_version(main_version: str, date: str) -> str:
    match = VERSION.fullmatch(main_version)
    if not match:
        raise SystemExit(f"main's version is not semver: {main_version!r}")
    major, minor, patch = (int(part) for part in match.groups()[:3])
    if match.group(4) is None:
        patch += 1
    return f"{major}.{minor}.{patch}-nightly.{date}"


def plan(repo: str, date: str) -> dict:
    sha = newest_green_commit(repo)
    if sha is None:
        return {"skip": "true", "reason": f"no passing CI in main's last {SEARCHED_COMMITS} commits"}

    published = nightly_releases(repo)
    if published:
        last = published[0]["tag_name"]
        built_from = gh_json(f"repos/{repo}/commits/{last}")["parents"][0]["sha"]
        if built_from == sha:
            return {"skip": "true", "reason": f"{last} already built {sha}"}

    package = gh_json(
        "-H", "Accept: application/vnd.github.raw",
        f"repos/{repo}/contents/apps/desktop/package.json?ref={sha}",
    )
    version = nightly_version(package["version"], date)
    tag = f"v{version}"
    if any(release["tag_name"] == tag for release in published):
        return {"skip": "true", "reason": f"{tag} is already published"}

    return {"skip": "false", "reason": f"building {sha}", "sha": sha, "version": version, "tag": tag}


def replace_once(path: Path, pattern: str, version: str) -> None:
    text = path.read_text()
    updated, count = re.subn(pattern, lambda m: f"{m.group(1)}{version}{m.group(2)}", text, count=1)
    if count != 1:
        raise SystemExit(f"No version to set in {path}")
    path.write_text(updated)


def bump(root: Path, version: str) -> None:
    if not VERSION.fullmatch(version):
        raise SystemExit(f"Not a version: {version!r}")
    for package in ("desktop", "daemon"):
        replace_once(root / "apps" / package / "package.json", r'^(\{\s*"name": "[^"]+",\s*"version": ")[^"]*(")', version)
        replace_once(
            root / "bun.lock",
            rf'("apps/{package}": \{{\s*"name": "@polaris/{package}",\s*"version": ")[^"]*(")',
            version,
        )


def prune(repo: str, keep: int, current: str) -> list:
    published = nightly_releases(repo)
    kept = {release["tag_name"] for release in published[:keep]} | {current}
    deleted = []
    for release in published[keep:]:
        if release["tag_name"] in kept:
            continue
        subprocess.run(
            ["gh", "release", "delete", release["tag_name"], "--cleanup-tag", "--yes"], check=True
        )
        deleted.append(release["tag_name"])

    released = {release["tag_name"] for release in published}
    for ref in gh_json(f"repos/{repo}/git/matching-refs/tags/v"):
        tag = ref["ref"].removeprefix("refs/tags/")
        if nightly_key(tag) and tag not in kept and tag not in released:
            subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/git/refs/tags/{tag}"], check=True)
            deleted.append(tag)
    return deleted


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("plan")
    bumping = commands.add_parser("bump")
    bumping.add_argument("--version", required=True)
    bumping.add_argument("--root", type=Path, default=Path.cwd())
    pruning = commands.add_parser("prune")
    pruning.add_argument("--keep", type=int, default=7)
    pruning.add_argument("--current", default="")
    args = parser.parse_args()

    if args.command == "bump":
        bump(args.root, args.version)
        return

    repo = os.environ["GH_REPO"]
    if args.command == "prune":
        for tag in prune(repo, args.keep, args.current):
            print(f"Deleted {tag}")
        return

    date = os.environ.get("NIGHTLY_DATE") or datetime.datetime.now(datetime.UTC).strftime("%Y%m%d")
    values = plan(repo, date)
    print(values["reason"])
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))


if __name__ == "__main__":
    main()

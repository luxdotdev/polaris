"""Plan, tag and prune the nightly builds of main for nightly-build.yml (docs/adr/0057).

  plan   picks the newest main commit whose required lane (the CI check) passed, and the
         nightly version for it: vX.Y.Z-nightly.YYYYMMDD, X.Y.Z the next patch after main's
         version (or main's own version while it is a prerelease). It skips when the newest
         nightly Release was built from that commit, or when today's nightly is published.
         Writes skip, reason, sha, version and tag to $GITHUB_OUTPUT.
  tag    commits the version onto --source and pushes only the tag, writing its commit as sha
         to $GITHUB_OUTPUT. An existing tag is never moved: an unreleased one whose commit has
         --source as its only parent and the very tree of this bump (a retry) is reused, any
         other unreleased one deleted first, a released one refused.
  bump   sets the Desktop App's and the Daemon's version (and bun.lock's record of them).
  prune  keeps the newest --keep nightly Releases and deletes the other nightly Releases and
         unreleased nightly tags, except --current (a failed run's tag stays until the next run).

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
RAW = ("-H", "Accept: application/vnd.github.raw")
BOT = ["-c", "user.name=github-actions[bot]",
       "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"]


def gh_json(*args: str):
    result = subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def gh_json_or_none(*args: str):
    """gh_json, or None when GitHub answers 404; any other failure raises."""
    result = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if result.returncode == 0:
        return json.loads(result.stdout)
    if "HTTP 404" in result.stderr:
        return None
    raise SystemExit(f"gh api {' '.join(args)} failed: {result.stderr.strip()}")


def nightly_key(tag: str):
    match = NIGHTLY_TAG.fullmatch(tag)
    return tuple(int(part) for part in match.groups()) if match else None


def all_releases(repo: str) -> list:
    releases, page = [], 1
    while True:
        batch = gh_json(f"repos/{repo}/releases?per_page={RELEASES_PER_PAGE}&page={page}")
        releases += batch
        if len(batch) < RELEASES_PER_PAGE:
            return releases
        page += 1


def nightly_releases(repo: str) -> list:
    """Published nightly Releases, newest version first."""
    nightlies = [r for r in all_releases(repo) if not r["draft"] and nightly_key(r["tag_name"])]
    return sorted(nightlies, key=lambda r: nightly_key(r["tag_name"]), reverse=True)


def release_exists(repo: str, tag: str) -> bool:
    return gh_json_or_none(f"repos/{repo}/releases/tags/{tag}") is not None


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


def desktop_version(repo: str, ref: str) -> str:
    return gh_json(*RAW, f"repos/{repo}/contents/apps/desktop/package.json?ref={ref}")["version"]


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

    version = nightly_version(desktop_version(repo, sha), date)
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
        replace_once(
            root / "apps" / package / "package.json",
            r'^(\{\s*"name": "[^"]+",\s*"version": ")[^"]*(")',
            version,
        )
        replace_once(
            root / "bun.lock",
            rf'("apps/{package}": \{{\s*"name": "@polaris/{package}",\s*"version": ")[^"]*(")',
            version,
        )


def reusable_tag(repo: str, tag: str, source: str, tree: str) -> str | None:
    """An unreleased `tag` whose commit is exactly this bump: `source`'s only child with `tree`.

    Content, not provenance, decides: any other change in the tree means it is deleted.
    """
    existing = gh_json_or_none(f"repos/{repo}/git/ref/tags/{tag}")
    if existing is None:
        return None
    if release_exists(repo, tag):
        raise SystemExit(f"{tag} already has a Release")
    sha = existing["object"]["sha"]
    if existing["object"]["type"] == "commit":
        commit = gh_json(f"repos/{repo}/git/commits/{sha}")
        parents = [parent["sha"] for parent in commit["parents"]]
        if parents == [source] and commit["tree"]["sha"] == tree:
            print(f"Reusing {tag} at {sha}: the same tree as this bump of {source}")
            return sha
    subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/git/refs/tags/{tag}"], check=True)
    print(f"Deleted unreleased {tag} at {sha}: not this bump of {source}")
    return None


def make_tag(repo: str, root: Path, version: str, tag: str, source: str) -> str:
    git = lambda *args: subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True)
    if git("rev-parse", "HEAD").stdout.strip() != source:
        raise SystemExit(f"The checkout is not {source}")
    bump(root, version)
    git(*BOT, "commit", "-q", "-am", f"nightly: {version}")
    tree = git("rev-parse", "HEAD^{tree}").stdout.strip()
    sha = reusable_tag(repo, tag, source, tree)
    if sha is not None:
        return sha
    git("tag", tag)
    git("push", "origin", f"refs/tags/{tag}")
    return git("rev-parse", "HEAD").stdout.strip()


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
        if not nightly_key(tag) or tag in kept or tag in released:
            continue
        # Asked of the tag itself, so a Release missing from the list never loses its tag.
        if release_exists(repo, tag):
            print(f"Kept {tag}: it has a Release")
            continue
        subprocess.run(["gh", "api", "-X", "DELETE", f"repos/{repo}/git/refs/tags/{tag}"], check=True)
        deleted.append(tag)
    return deleted


def write_outputs(values: dict) -> None:
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("".join(f"{key}={value}\n" for key, value in values.items()))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("plan")
    tagging = commands.add_parser("tag")
    tagging.add_argument("--version", required=True)
    tagging.add_argument("--tag", required=True)
    tagging.add_argument("--source", required=True)
    tagging.add_argument("--root", type=Path, default=Path.cwd())
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

    if args.command == "tag":
        if f"v{args.version}" != args.tag or not nightly_key(args.tag):
            raise SystemExit(f"{args.tag} is not the nightly tag of {args.version}")
        write_outputs({"sha": make_tag(repo, args.root, args.version, args.tag, args.source)})
        return

    date = os.environ.get("NIGHTLY_DATE") or datetime.datetime.now(datetime.UTC).strftime("%Y%m%d")
    values = plan(repo, date)
    print(values["reason"])
    write_outputs(values)


if __name__ == "__main__":
    main()

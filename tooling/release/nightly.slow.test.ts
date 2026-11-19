import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";

const SCRIPT = join(import.meta.dir, "nightly.py");

const REPO_ROOT = join(import.meta.dir, "../..");

// Each test spawns python3; CI's macOS runners take over 5 s for some (ENG-976).
setDefaultTimeout(30_000);

const REPO = "luxdotdev/polaris";

/** gh answers `api` calls from a map of endpoints and records every call. */
const FAKE_GH = `#!/usr/bin/env -S python3 -I -S
import json, os, sys
args = sys.argv[1:]
with open(os.path.join(os.environ["FAKE_ROOT"], "calls"), "a") as calls:
    calls.write(" ".join(args) + "\\n")
if args[0] == "api":
    endpoint = [a for a in args[1:] if not a.startswith("-") and not a.startswith("Accept:")][-1]
    if "-X" in args:
        sys.exit(0)
    answers = json.load(open(os.path.join(os.environ["FAKE_ROOT"], "answers.json")))
    if endpoint not in answers:
        sys.stderr.write("gh: Not Found (HTTP 404)\\n")
        sys.exit(1)
    print(json.dumps(answers[endpoint]))
`;

/** git records every call; HEAD is the source commit until a commit is made. */
const FAKE_GIT = `#!/bin/bash
set -euo pipefail
printf 'git %s\\n' "$*" >> "$FAKE_ROOT/calls"
case "$*" in
  *" commit "*) touch "$FAKE_ROOT/committed" ;;
  "rev-parse HEAD") if [[ -e "$FAKE_ROOT/committed" ]]; then echo bump; else echo c2; fi ;;
  "rev-parse HEAD^{tree}") echo bump-tree ;;
esac
`;

const decodePackage = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
);

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** GitHub's JSON, as the fake gh prints it. */
type GitHubJson =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<GitHubJson>
  | { readonly [key: string]: GitHubJson };

/** What the fake gh prints for each endpoint. */
interface Answers {
  readonly [endpoint: string]: GitHubJson;
}

const setup = (answers: Answers) => {
  const root = mkdtempSync(join(tmpdir(), "release-nightly-"));

  roots.push(root);
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "gh"), FAKE_GH, { mode: 0o755 });
  writeFileSync(join(root, "bin", "git"), FAKE_GIT, { mode: 0o755 });
  writeFileSync(join(root, "answers.json"), JSON.stringify(answers));
  writeFileSync(join(root, "github-output"), "");

  const run = (...args: Array<string>) => {
    const result = Bun.spawnSync(["python3", "-I", SCRIPT, ...args], {
      env: {
        PATH: `${root}/bin:${process.env.PATH}`,
        FAKE_ROOT: root,
        GH_REPO: REPO,
        GITHUB_OUTPUT: join(root, "github-output"),
        NIGHTLY_DATE: "20261119",
      },
    });

    return { ok: result.exitCode === 0, error: result.stderr.toString() };
  };

  const outputs = () =>
    Object.fromEntries(
      readFileSync(join(root, "github-output"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    );

  const calls = () =>
    existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8").trim().split("\n")
      : [];

  return { root, run, outputs, calls };
};

const checks = (conclusion: string | null, slug = "github-actions") => ({
  check_runs: [{ name: "CI", app: { slug }, conclusion }],
});

const release = (tag: string, draft = false) => ({ tag_name: tag, draft, prerelease: true });

/** main: c3 (CI running), c2 (CI green), c1 (green). */
const main = (releases: ReadonlyArray<GitHubJson>, extra: Answers = {}) => ({
  [`repos/${REPO}/commits?sha=main&per_page=30`]: [{ sha: "c3" }, { sha: "c2" }, { sha: "c1" }],
  [`repos/${REPO}/commits/c3/check-runs?check_name=CI&filter=latest`]: checks(null),
  [`repos/${REPO}/commits/c2/check-runs?check_name=CI&filter=latest`]: checks("success"),
  [`repos/${REPO}/commits/c1/check-runs?check_name=CI&filter=latest`]: checks("success"),
  [`repos/${REPO}/contents/apps/desktop/package.json?ref=c2`]: { version: "0.11.0" },
  [`repos/${REPO}/releases?per_page=100&page=1`]: releases,
  ...extra,
});

describe("nightly plan", () => {
  test("builds the newest commit whose CI passed, as the next patch's nightly", () => {
    const { run, outputs } = setup(
      main([release("v0.11.1-nightly.20261118")], {
        [`repos/${REPO}/commits/v0.11.1-nightly.20261118`]: { parents: [{ sha: "c1" }] },
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs()).toEqual({
      skip: "false",
      reason: "building c2",
      sha: "c2",
      version: "0.11.1-nightly.20261119",
      tag: "v0.11.1-nightly.20261119",
    });
  });

  test("skips when the newest nightly was built from the same commit", () => {
    const { run, outputs } = setup(
      main([release("v0.11.1-nightly.20261117"), release("v0.11.1-nightly.20261118")], {
        [`repos/${REPO}/commits/v0.11.1-nightly.20261118`]: { parents: [{ sha: "c2" }] },
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs()).toEqual({
      skip: "true",
      reason: "v0.11.1-nightly.20261118 already built c2",
    });
  });

  test("a check named CI from another app does not count as the required lane", () => {
    const { run, outputs } = setup(
      main([], {
        [`repos/${REPO}/commits/c2/check-runs?check_name=CI&filter=latest`]: checks(
          "success",
          "impostor"
        ),
        [`repos/${REPO}/contents/apps/desktop/package.json?ref=c1`]: { version: "0.11.0" },
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs().sha).toBe("c1");
  });

  test("while main carries a prerelease, the nightly is of that version, not the next patch", () => {
    const { run, outputs } = setup(
      main([], {
        [`repos/${REPO}/contents/apps/desktop/package.json?ref=c2`]: { version: "0.12.0-rc.1" },
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs().version).toBe("0.12.0-nightly.20261119");
  });

  test("skips when today's nightly is already published from an older commit", () => {
    const { run, outputs } = setup(
      main([release("v0.11.1-nightly.20261119")], {
        [`repos/${REPO}/commits/v0.11.1-nightly.20261119`]: { parents: [{ sha: "c1" }] },
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs()).toEqual({
      skip: "true",
      reason: "v0.11.1-nightly.20261119 is already published",
    });
  });

  test("skips when no recent main commit passed CI", () => {
    const { run, outputs } = setup(
      main([], {
        [`repos/${REPO}/commits/c2/check-runs?check_name=CI&filter=latest`]: checks("failure"),
        [`repos/${REPO}/commits/c1/check-runs?check_name=CI&filter=latest`]: checks(null),
      })
    );

    expect(run("plan").ok).toBe(true);
    expect(outputs().skip).toBe("true");
  });
});

describe("nightly prune", () => {
  const nightlies = Array.from({ length: 9 }, (_, day) =>
    release(`v0.11.1-nightly.202611${String(day + 10).padStart(2, "0")}`)
  );

  /** 100 stable Releases fill page 1, so the oldest nightlies are only on page 2. */
  const stables = Array.from({ length: 95 }, (_, n) => ({
    tag_name: `v0.0.${n}`,
    draft: false,
    prerelease: false,
  }));

  test("reads every page, keeps the newest seven and deletes the rest and orphaned nightly tags", () => {
    const newestFirst = nightlies.toReversed();

    const { run, calls } = setup({
      [`repos/${REPO}/releases?per_page=100&page=1`]: [...newestFirst.slice(0, 5), ...stables],
      [`repos/${REPO}/releases?per_page=100&page=2`]: [
        ...newestFirst.slice(5),
        { tag_name: "v0.11.0", draft: false, prerelease: false },
        release("v0.11.0-nightly.20261101", true),
      ],
      [`repos/${REPO}/git/matching-refs/tags/v`]: [
        ...nightlies.map((r) => ({ ref: `refs/tags/${r.tag_name}` })),
        { ref: "refs/tags/v0.11.0" },
        { ref: "refs/tags/v0.11.1-nightly.20261105" },
        { ref: "refs/tags/v0.11.1-nightly.20261108" },
        { ref: "refs/tags/v0.11.1-nightly.20261120" },
      ],
      // Published, yet missing from the list: its tag stays.
      [`repos/${REPO}/releases/tags/v0.11.1-nightly.20261105`]: release("v0.11.1-nightly.20261105"),
    });

    expect(run("prune", "--keep", "7", "--current", "v0.11.1-nightly.20261120").ok).toBe(true);
    expect(calls().filter((call) => !call.startsWith("api repos/"))).toEqual([
      "release delete v0.11.1-nightly.20261111 --cleanup-tag --yes",
      "release delete v0.11.1-nightly.20261110 --cleanup-tag --yes",
      "api -X DELETE repos/luxdotdev/polaris/git/refs/tags/v0.11.1-nightly.20261108",
    ]);
  });
});

describe("nightly tag", () => {
  const TAG = "v0.11.1-nightly.20261119";

  const tagSetup = (answers: Answers) => {
    const f = setup(answers);

    for (const path of ["apps/desktop/package.json", "apps/daemon/package.json", "bun.lock"]) {
      mkdirSync(join(f.root, "repo", path, ".."), { recursive: true });
      cpSync(join(REPO_ROOT, path), join(f.root, "repo", path));
    }

    const tag = () =>
      f.run(
        "tag",
        "--version",
        TAG.slice(1),
        "--tag",
        TAG,
        "--source",
        "c2",
        "--root",
        join(f.root, "repo")
      );

    return { ...f, tag, git: () => f.calls().filter((call) => call.startsWith("git ")) };
  };

  const existing = (parent: string, tree = "bump-tree") => ({
    [`repos/${REPO}/git/ref/tags/${TAG}`]: { object: { sha: "old", type: "commit" } },
    [`repos/${REPO}/git/commits/old`]: { parents: [{ sha: parent }], tree: { sha: tree } },
  });

  const pushed = (calls: Array<string>) =>
    calls.some((call) => call.startsWith("git tag ") || call.startsWith("git push "));

  test("commits the version onto the source and pushes only the tag", () => {
    const { tag, git, outputs } = tagSetup({});

    expect(tag().ok).toBe(true);
    const [commit, ...rest] = git().filter((call) => !call.startsWith("git rev-parse"));

    expect(commit).toEndWith(" commit -q -am nightly: 0.11.1-nightly.20261119");
    expect(rest).toEqual([`git tag ${TAG}`, `git push origin refs/tags/${TAG}`]);
    expect(outputs()).toEqual({ sha: "bump" });
  });

  test("a retry reuses today's unreleased tag with this bump's exact tree, and moves nothing", () => {
    const { tag, git, calls, outputs } = tagSetup(existing("c2"));

    expect(tag().ok).toBe(true);
    expect(pushed(git())).toBe(false);
    expect(calls().some((call) => call.includes("-X DELETE"))).toBe(false);
    expect(outputs()).toEqual({ sha: "old" });
  });

  test.each([
    ["another source commit", existing("c1")],
    ["the right parent but any other change in its tree", existing("c2", "tampered-tree")],
  ])("an unreleased tag of %s is deleted, then the tag is made afresh", (_, answers) => {
    const { tag, git, calls, outputs } = tagSetup(answers);

    expect(tag().ok).toBe(true);
    expect(calls()).toContain(`api -X DELETE repos/${REPO}/git/refs/tags/${TAG}`);
    expect(git()).toContain(`git push origin refs/tags/${TAG}`);
    expect(outputs()).toEqual({ sha: "bump" });
  });

  test("a released tag is never deleted or reused", () => {
    const { tag, calls } = tagSetup({
      ...existing("c1"),
      [`repos/${REPO}/releases/tags/${TAG}`]: release(TAG),
    });

    const result = tag();

    expect(result.ok).toBe(false);
    expect(result.error).toContain(`${TAG} already has a Release`);
    expect(calls().some((call) => call.includes("-X DELETE"))).toBe(false);
    expect(pushed(calls())).toBe(false);
  });
});

describe("nightly bump", () => {
  test("sets the Desktop App's and the Daemon's version and bun.lock's record of them", () => {
    const { root, run } = setup({});

    for (const path of ["apps/desktop/package.json", "apps/daemon/package.json", "bun.lock"]) {
      mkdirSync(join(root, "repo", path, ".."), { recursive: true });
      cpSync(join(REPO_ROOT, path), join(root, "repo", path));
    }

    const before = readFileSync(join(root, "repo", "bun.lock"), "utf8");

    expect(
      run("bump", "--version", "0.11.1-nightly.20261119", "--root", join(root, "repo")).ok
    ).toBe(true);

    for (const name of ["desktop", "daemon"]) {
      const json = decodePackage(
        readFileSync(join(root, "repo", "apps", name, "package.json"), "utf8")
      );

      expect(json.version).toBe("0.11.1-nightly.20261119");
    }

    const after = readFileSync(join(root, "repo", "bun.lock"), "utf8");
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);

    expect(changed).toEqual([
      '      "version": "0.11.1-nightly.20261119",',
      '      "version": "0.11.1-nightly.20261119",',
    ]);
  });

  test("refuses a version that is not semver", () => {
    const { run, root } = setup({});

    expect(run("bump", "--version", "nightly", "--root", root).error).toContain("Not a version");
  });
});

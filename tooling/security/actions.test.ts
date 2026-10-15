import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "../lint/oxlint.ts";
import { unpinnedActions, usesIn } from "./actions.ts";

const SHA = "11d5960a326750d5838078e36cf38b85af677262";

const made: Array<string> = [];

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repository holding `files` under `.github/`. */
const repo = (files: Record<string, string>) => {
  const root = mkdtempSync(join(tmpdir(), "polaris-actions-"));
  made.push(root);

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, ".github", path, ".."), { recursive: true });
    writeFileSync(join(root, ".github", path), text);
  }

  return root;
};

describe("GitHub Actions are pinned to a commit", () => {
  test("every external action in this repository's workflows and actions is pinned", () => {
    expect(unpinnedActions(ROOT)).toEqual([]);
  });

  test("a planted tag, branch or short SHA is reported wherever it is used", () => {
    const root = repo({
      "workflows/ci.yml": [
        "on: push",
        "jobs:",
        "  build:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        `      - uses: actions/checkout@${SHA} # v4.4.0`,
        "      - uses: actions/setup-node@v4",
        "      - uses: ./.github/actions/local",
        "  shared:",
        "    uses: org/workflows/.github/workflows/release.yml@main",
      ].join("\n"),
      "actions/local/action.yaml": [
        "runs:",
        "  using: composite",
        "  steps:",
        "    - uses: oven-sh/setup-bun@0c5077e",
        "    - run: echo ok",
      ].join("\n"),
    });

    expect([...unpinnedActions(root)].sort()).toEqual([
      ".github/actions/local/action.yaml: oven-sh/setup-bun@0c5077e",
      ".github/workflows/ci.yml: actions/setup-node@v4",
      ".github/workflows/ci.yml: org/workflows/.github/workflows/release.yml@main",
    ]);
  });

  test("a Docker image passes only by digest", () => {
    const yaml = (uses: string) => `jobs:\n  a:\n    steps:\n      - uses: ${uses}\n`;
    const digest = `docker://alpine@sha256:${"a".repeat(64)}`;

    expect(usesIn(yaml(digest))).toEqual([digest]);
    expect(unpinnedActions(repo({ "workflows/a.yml": yaml("docker://alpine:3.20") }))).toEqual([
      ".github/workflows/a.yml: docker://alpine:3.20",
    ]);
    expect(unpinnedActions(repo({ "workflows/a.yml": yaml(digest) }))).toEqual([]);
  });
});

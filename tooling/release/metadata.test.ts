import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "metadata.py");

const run = (tag: string, version: string) => {
  const root = mkdtempSync(join(tmpdir(), "release-metadata-"));

  for (const name of ["desktop", "daemon"]) {
    mkdirSync(join(root, "apps", name), { recursive: true });
    writeFileSync(join(root, "apps", name, "package.json"), JSON.stringify({ version }));
  }

  const output = join(root, "github-output");

  writeFileSync(output, "");

  const result = Bun.spawnSync(["python3", "-I", SCRIPT, "--root", root], {
    env: { PATH: process.env.PATH ?? "", RELEASE_TAG: tag, GITHUB_OUTPUT: output },
  });

  const values = Object.fromEntries(
    readFileSync(output, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key = "", value = ""] = line.split("=");

        return [key, value];
      })
  );

  return { ok: result.exitCode === 0, error: result.stderr.toString(), values };
};

describe("release tag", () => {
  test.each([
    ["v0.1.0-alpha.1", "0.1.0-alpha1", "true"],
    ["v0.1.0-beta.2", "0.1.0-beta2", "true"],
    ["v0.1.0-rc.10", "0.1.0-rc10", "true"],
    ["v0.1.0", "0.1.0", "false"],
  ])("%s has NuGet version %s, prerelease %s", (tag, nuget, prerelease) => {
    const { ok, values } = run(tag, tag.slice(1));

    expect(ok).toBe(true);
    expect(values).toEqual({ version: tag.slice(1), nuget_version: nuget, prerelease });
  });

  test.each([
    "0.1.0-alpha.1",
    "v0.1.0-alpha",
    "v0.1.0-alpha.01",
    "v0.1.0-dev.1",
    "v0.1.0-gamma.1",
    "v01.1.0",
    "v0.1.0-alpha.1+build",
  ])("rejects %s", (tag) => {
    const { ok, error } = run(tag, tag.replace(/^v/, ""));

    expect(ok).toBe(false);
    expect(error).toContain("Expected v<major>.<minor>.<patch>");
  });

  test("the packages must carry the tag's version", () => {
    const { ok, error } = run("v0.1.0-alpha.2", "0.1.0-alpha.1");

    expect(ok).toBe(false);
    expect(error).toContain("Tag/version mismatch: desktop is 0.1.0-alpha.1");
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "metadata.py");

const NAMES = [
  "MACOS_CERT_P12",
  "MACOS_CERT_PASSWORD",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "APPLE_TEAM_ID",
];

// release.yml passes `secrets.X != ''`, never the value: "true" or "false".
const flags = (value: string) => Object.fromEntries(NAMES.map((name) => [`${name}_SET`, value]));

const SIGNING = flags("true");

const run = (tag: string, version: string, secrets: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "release-metadata-"));

  for (const name of ["desktop", "daemon"]) {
    mkdirSync(join(root, "apps", name), { recursive: true });
    writeFileSync(join(root, "apps", name, "package.json"), JSON.stringify({ version }));
  }

  const output = join(root, "github-output");

  writeFileSync(output, "");

  const result = Bun.spawnSync(["python3", "-I", SCRIPT, "--root", root], {
    env: { PATH: process.env.PATH ?? "", RELEASE_TAG: tag, GITHUB_OUTPUT: output, ...secrets },
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
    ["v0.1.0-alpha.1", "0.1.0-alpha1"],
    ["v0.1.0-beta.2", "0.1.0-beta2"],
    ["v0.1.0-rc.10", "0.1.0-rc10"],
  ])("%s is an unsigned-capable prerelease", (tag, nuget) => {
    const { ok, values } = run(tag, tag.slice(1));

    expect(ok).toBe(true);
    expect(values).toEqual({
      version: tag.slice(1),
      nuget_version: nuget,
      prerelease: "true",
      signed: "false",
    });
  });

  test("a stable tag needs every signing secret", () => {
    expect(run("v0.1.0", "0.1.0").error).toContain("Stable tags require all six signing secrets");
    expect(run("v0.1.0", "0.1.0", SIGNING).values).toEqual({
      version: "0.1.0",
      nuget_version: "0.1.0",
      prerelease: "false",
      signed: "true",
    });
  });

  test('secrets flagged "false" are absent: a prerelease stays unsigned', () => {
    expect(run("v0.1.0-alpha.1", "0.1.0-alpha.1", flags("false")).values.signed).toBe("false");
  });

  test("partial signing secrets fail", () => {
    const { ok, error } = run("v0.1.0-alpha.1", "0.1.0-alpha.1", {
      ...flags("false"),
      APPLE_TEAM_ID_SET: "true",
    });

    expect(ok).toBe(false);
    expect(error).toContain("Incomplete signing secrets");
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

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";

const workflow = Schema.decodeUnknownSync(
  Schema.Struct({
    jobs: Schema.Record(
      Schema.String,
      Schema.Struct({
        steps: Schema.Array(Schema.Struct({ run: Schema.optional(Schema.String) })),
      })
    ),
  })
)(
  Bun.YAML.parse(readFileSync(join(import.meta.dir, "../../.github/workflows/release.yml"), "utf8"))
);

const script = (job: string, marker: string) => {
  const run = workflow.jobs[job]?.steps.find((step) => step.run?.includes(marker))?.run;

  if (run === undefined) throw new Error(`Missing ${job} step: ${marker}`);

  return run;
};

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "release-shell-"));

  roots.push(root);
  mkdirSync(join(root, "bin"));

  const file = (path: string, contents: string) => {
    writeFileSync(join(root, path), contents);
  };

  const executable = (name: string, contents: string) => {
    writeFileSync(join(root, "bin", name), `#!/bin/bash\nset -euo pipefail\n${contents}`, {
      mode: 0o755,
    });
  };

  const run = (source: string, env: Record<string, string>) => {
    const result = Bun.spawnSync(["bash", "-euo", "pipefail", "-c", source], {
      cwd: root,
      env: { PATH: `${root}/bin:${process.env.PATH}`, RUNNER_TEMP: root, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });

    return { code: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
  };

  const calls = () =>
    existsSync(join(root, "calls"))
      ? readFileSync(join(root, "calls"), "utf8").trim().split("\n")
      : [];

  return { root, file, executable, run, calls };
};

const digest = (contents: string) => createHash("sha256").update(contents).digest("hex");

const npmFixture = () => {
  const f = fixture();

  mkdirSync(join(f.root, "handoff"));
  f.file("handoff/polaris-sdk.tgz", "packed SDK");
  f.executable(
    "npm",
    `
if [[ "$1" == --version ]]; then echo "\${NPM_VERSION:-11.19.1}"; exit 0; fi
printf '%s\\n' "$*" >> calls
if [[ "$1" == view ]]; then
  if [[ "$EXISTS" == true ]]; then echo "\${2##*@}"; exit 0; fi
  exit 1
fi
test "$1" = publish
cp "$2" published.tgz
shift 2
tag=latest
while [[ "$#" -gt 0 ]]; do
  if [[ "$1" == --tag ]]; then tag="$2"; shift; fi
  shift
done
printf '%s\\n' "\${PACKAGE##*@}" "$tag" > published
`
  );

  const run = (env: Record<string, string> = {}) =>
    f.run(script("npm", "npm publish"), {
      PACKAGE: "@doellsoftware/polaris-sdk@0.1.0",
      TARBALL_SHA256: digest("packed SDK"),
      EXISTS: "false",
      ...env,
    });

  return { ...f, run };
};

describe("npm release shell", () => {
  test.each([
    ["0.1.0", "true", "latest"],
    ["0.2.0-rc.1", "false", "next"],
  ])(
    "SDK %s uses its own channel regardless of Polaris prerelease=%s",
    (version, prerelease, tag) => {
      const f = npmFixture();

      const result = f.run({
        PACKAGE: `@doellsoftware/polaris-sdk@${version}`,
        PRERELEASE: prerelease,
      });

      expect(result).toMatchObject({ code: 0 });
      expect(readFileSync(join(f.root, "published"), "utf8")).toBe(`${version}\n${tag}\n`);
      expect(readFileSync(join(f.root, "published.tgz"), "utf8")).toBe("packed SDK");
    }
  );

  test.each(["0.1.0", "0.2.0-rc.1"])(
    "an existing exact SDK version %s is not republished or retagged",
    (version) => {
      const f = npmFixture();

      expect(f.run({ EXISTS: "true", PACKAGE: `@doellsoftware/polaris-sdk@${version}` }).code).toBe(
        0
      );
      expect(existsSync(join(f.root, "published"))).toBe(false);
      expect(f.calls()).toEqual([`view @doellsoftware/polaris-sdk@${version} version`]);
    }
  );

  test("a changed tarball is refused before any registry request", () => {
    const f = npmFixture();

    f.file("handoff/polaris-sdk.tgz", "changed bytes");
    expect(f.run().code).not.toBe(0);
    expect(existsSync(join(f.root, "published"))).toBe(false);
    expect(f.calls()).toEqual([]);
  });

  test("a different npm version fails closed", () => {
    const f = npmFixture();

    expect(f.run({ NPM_VERSION: "10.0.0" }).code).not.toBe(0);
    expect(f.calls()).toEqual([]);
  });
});

const publishFixture = () => {
  const f = fixture();

  const env = {
    VERSION: "0.3.0",
    RELEASE_TAG: "v0.3.0",
    GH_REPO: "fixture/polaris",
    PRERELEASE: "false",
    WINDOWS_SHA256: "",
    RAYCAST_SHA256: "",
  };

  const checksums: Record<string, string> = {};

  f.executable(
    "gh",
    `
if [[ "$1" == api ]]; then echo 'HTTP 404' >&2; exit 1; fi
test "$1 $2" = 'release create'
printf '%s\\n' "$@" > calls
`
  );

  const handoff = (name: string, names: Array<string>) => {
    mkdirSync(join(f.root, "handoff", name), { recursive: true });

    for (const asset of names) f.file(`handoff/${name}/${asset}`, "asset bytes");

    const sums = names.map((asset) => `${digest("asset bytes")}  ${asset}\n`).join("");

    f.file(`handoff/${name}/assets.sha256`, sums);
    checksums[`${name.toUpperCase()}_SHA256`] = digest(sums);
  };

  handoff("macos", [
    "Polaris-0.3.0-arm64-mac.zip",
    "polaris-daemon-0.3.0-SHA256SUMS",
    ...[
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "windows-x64",
      "windows-arm64",
    ].map((platform) => `polaris-daemon-0.3.0-${platform}.tar.gz`),
  ]);
  handoff("dmg", ["Polaris-0.3.0-arm64.dmg"]);

  return {
    ...f,
    handoff,
    run: () => f.run(script("publish", "gh release create"), { ...env, ...checksums }),
  };
};

describe("GitHub Release shell", () => {
  test("signed assets draft successfully without Windows or Raycast", () => {
    const f = publishFixture();

    expect(f.run().code).toBe(0);
    expect(f.calls()).toContain("handoff/dmg/Polaris-0.3.0-arm64.dmg");
    expect(f.calls().some((arg) => arg.includes("raycast"))).toBe(false);
    expect(f.calls()).toContain("--draft");
  });

  test("a successful Raycast ZIP is included after checking its bytes", () => {
    const f = publishFixture();

    f.handoff("raycast", ["polaris-raycast-0.3.0.zip"]);
    expect(f.run().code).toBe(0);
    expect(f.calls()).toContain("handoff/raycast/polaris-raycast-0.3.0.zip");
  });

  test("a changed Raycast ZIP cannot reach GitHub", () => {
    const f = publishFixture();

    f.handoff("raycast", ["polaris-raycast-0.3.0.zip"]);
    f.file("handoff/raycast/polaris-raycast-0.3.0.zip", "tampered");
    expect(f.run().code).not.toBe(0);
    expect(f.calls()).toEqual([]);
  });

  test("even a digest-checked handoff cannot smuggle an .ehpk into the Release", () => {
    const f = publishFixture();

    f.handoff("raycast", ["polaris-raycast-0.3.0.zip", "polaris-g2.ehpk"]);
    expect(f.run().code).not.toBe(0);
    expect(f.calls()).toEqual([]);
  });
});

test("G2 Hosts are arguments: commas and whitespace split, shell syntax never executes or globs", () => {
  const f = fixture();

  f.file("should-not-expand", "fixture");
  f.executable(
    "bun",
    `
printf '%s\\n' "$@" > calls
mkdir -p extensions/even-g2/build
printf package > extensions/even-g2/build/polaris-g2-test.ehpk
`
  );
  expect(
    f.run(script("even-g2", "extensions/even-g2 pack"), {
      EVEN_G2_HOSTS: "one.test,two.test\nthree.test $(touch attacked) `touch attacked2` * ;echo",
    }).code
  ).toBe(0);
  expect(existsSync(join(f.root, "attacked"))).toBe(false);
  expect(existsSync(join(f.root, "attacked2"))).toBe(false);
  expect(f.calls()).toEqual([
    "run",
    "--cwd",
    "extensions/even-g2",
    "pack",
    ...[
      "one.test",
      "two.test",
      "three.test",
      "$(touch",
      "attacked)",
      "`touch",
      "attacked2`",
      "*",
      ";echo",
    ].flatMap((host) => ["--host", host]),
  ]);
});

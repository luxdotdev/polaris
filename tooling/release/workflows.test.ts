import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Schema } from "effect";
import { PLATFORMS } from "../../packages/client/src/install/builds.ts";

const GITHUB = join(import.meta.dir, "../../.github");

const Step = Schema.Struct({
  id: Schema.optional(Schema.String),
  if: Schema.optional(Schema.String),
  uses: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  shell: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const Job = Schema.Struct({
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  "continue-on-error": Schema.optional(Schema.Boolean),
  needs: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  if: Schema.optional(Schema.String),
  environment: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  defaults: Schema.optional(
    Schema.Struct({
      run: Schema.optional(Schema.Struct({ shell: Schema.optional(Schema.String) })),
    })
  ),
  steps: Schema.Array(Step),
});

const Workflow = Schema.Struct({
  on: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  jobs: Schema.Record(Schema.String, Job),
});

/** A job that calls a reusable workflow has `uses` and `with` instead of steps. */
const CallerJob = Schema.Struct({
  ...Job.fields,
  uses: Schema.optional(Schema.String),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  secrets: Schema.optional(Schema.Unknown),
  steps: Schema.optional(Schema.Array(Step)),
});

const NightlyWorkflow = Schema.Struct({
  on: Schema.Record(Schema.String, Schema.Unknown),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  jobs: Schema.Record(Schema.String, CallerJob),
});

const files = [
  ...readdirSync(join(GITHUB, "workflows")).map((name) => join(GITHUB, "workflows", name)),
  ...readdirSync(join(GITHUB, "actions")).map((name) =>
    join(GITHUB, "actions", name, "action.yml")
  ),
];

const release = Schema.decodeUnknownSync(Workflow)(
  Bun.YAML.parse(readFileSync(join(GITHUB, "workflows/release.yml"), "utf8"))
);

const nightly = Schema.decodeUnknownSync(NightlyWorkflow)(
  Bun.YAML.parse(readFileSync(join(GITHUB, "workflows/nightly-build.yml"), "utf8"))
);

/** The signing jobs' environment: `nightly` when nightly-build.yml calls, else `release`. */
const SIGNING_ENVIRONMENT = "${{ inputs.channel == 'nightly' && 'nightly' || 'release' }}";

/** The default branch; a scheduled (nightly) run's event has no repository, so main. */
const SIGNER_REF = "${{ github.event.repository.default_branch || 'main' }}";

/** The Apple signing secrets: what the signing jobs read, and what a caller must pass by name. */
const APPLE_SECRETS = [
  "MACOS_CERT_P12",
  "MACOS_CERT_PASSWORD",
  "MACOS_SIGNING_IDENTITY",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "APPLE_API_ISSUER",
  "APPLE_TEAM_ID",
];

/** Every workflow and composite action, loosely: only steps, shells and defaults matter here. */
const LooseJob = Schema.Struct({
  defaults: Schema.optional(
    Schema.Struct({
      run: Schema.optional(Schema.Struct({ shell: Schema.optional(Schema.String) })),
    })
  ),
  steps: Schema.optional(Schema.Array(Step)),
});

const Loose = Schema.Struct({
  jobs: Schema.optional(Schema.Record(Schema.String, LooseJob)),
  runs: Schema.optional(Schema.Struct({ steps: Schema.optional(Schema.Array(Step)) })),
});

/** A secret's value, as opposed to a `secrets.X != ''` presence check. */
const SECRET_VALUE = /secrets(?:\.\w+\b(?!\s*!=)|\s*\[)/;

const holdsSecrets = (job: typeof Job.Type | typeof CallerJob.Type) =>
  SECRET_VALUE.test(JSON.stringify(job));

/** The jobs that hold Apple's signing credentials: the ones in a signing environment. */
const appleJobs = () =>
  Object.entries(release.jobs).filter(([, job]) => job.environment === SIGNING_ENVIRONMENT);

const writes = (job: typeof Job.Type | typeof CallerJob.Type) =>
  Object.entries(job.permissions ?? {}).filter(([, level]) => level === "write");

describe("workflow shells", () => {
  test.each(files.map((file) => [relative(GITHUB, file), file]))(
    "%s fails a step whose piped command fails: a pipe into tee runs with pipefail",
    (_, file) => {
      const workflow = Schema.decodeUnknownSync(Loose)(Bun.YAML.parse(readFileSync(file, "utf8")));

      const steps = [
        ...Object.values(workflow.jobs ?? {}).flatMap((job) =>
          (job.steps ?? []).map((step) => ({ step, shell: step.shell ?? job.defaults?.run?.shell }))
        ),
        ...(workflow.runs?.steps ?? []).map((step) => ({ step, shell: step.shell })),
      ];

      const unsafe = steps.flatMap(({ step, shell }) => {
        const run = step.run ?? "";
        const pipefail = shell === "bash" || /set -\w*o pipefail/.test(run);

        return /\|\s*tee\b/.test(run) && !pipefail ? [run] : [];
      });

      expect(unsafe).toEqual([]);
    }
  );
});

describe("workflow supply chain", () => {
  test.each(files.map((file) => [relative(GITHUB, file), file]))(
    "%s runs external actions only at a full commit SHA",
    (_, file) => {
      const unpinned = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^\s*-?\s*uses:/.test(line))
        .filter(
          (line) => !/uses: (\.\/\S+|[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d\S*)\s*$/.test(line)
        );

      expect(unpinned).toEqual([]);
    }
  );
});

describe("release authority", () => {
  test("only publish writes the Release and npm mints its provenance token; publish holds no secrets", () => {
    expect(release.permissions).toEqual({});
    expect(release.env).toBeUndefined();
    expect(
      Object.entries(release.jobs).flatMap(([name, job]) =>
        writes(job).map(([scope]) => `${name}:${scope}`)
      )
    ).toEqual(["npm:id-token", "publish:contents"]);
    expect(holdsSecrets(release.jobs.publish!)).toBe(false);
  });

  test("only the signing jobs hold secrets, each behind the release or nightly environment", () => {
    expect(
      Object.entries(release.jobs)
        .filter(([, job]) => holdsSecrets(job))
        .map(([name, job]) => [name, job.environment])
    ).toEqual([
      ["sign", SIGNING_ENVIRONMENT],
      ["sign-dmg", SIGNING_ENVIRONMENT],
    ]);
  });

  test("jobs with Apple credentials run only the default branch's signer", () => {
    const signers = appleJobs();

    expect(signers.map(([name]) => name)).toEqual(["sign", "sign-dmg"]);

    for (const [, job] of signers) {
      for (const step of job.steps) {
        if (step.uses !== undefined)
          expect(step.uses).toMatch(/^actions\/(checkout|download-artifact|upload-artifact)@/);

        if (step.uses?.startsWith("actions/checkout@")) expect(step.with?.ref).toBe(SIGNER_REF);

        expect(step.run ?? "").not.toMatch(/\b(bunx?|node|npx?|uvx?|pip3?|pnpm|yarn|make)\b/);
      }
    }
  });

  test("jobs with Apple credentials touch hand-offs only through the signer", () => {
    for (const [, job] of appleJobs()) {
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/download-artifact@")) {
          expect(step.with?.name).toBeUndefined();
          expect(String(step.with?.["artifact-ids"])).toMatch(/^\$\{\{ needs\.[\w-]+\.outputs\./);
        }

        if (step.run?.startsWith("python3 -I signer/tooling/release/sign.py ")) continue;

        expect(step.run ?? "").not.toMatch(/\b(tar|cp|mv|ln|ditto|unzip|shasum|cd)\b/);
      }
    }
  });
});

describe("SDK on npm", () => {
  const npm = release.jobs.npm!;

  test("the npm job runs no repository code: it publishes the packed tarball it checked", () => {
    expect(npm.steps.map((step) => step.uses?.replace(/@.*/, "") ?? "run")).toEqual([
      "actions/setup-node",
      "actions/download-artifact",
      "run",
    ]);
    expect(npm.steps[1]?.with?.name).toBeUndefined();
    expect(String(npm.steps[1]?.with?.["artifact-ids"])).toBe(
      "${{ needs.sdk.outputs.tarball-id }}"
    );

    const run = npm.steps[2]?.run ?? "";

    expect(run).not.toMatch(/\b(bunx?|node|npx|uvx?|pnpm|yarn|make|tar)\b/);
    expect(run.indexOf("sha256sum --check")).toBeGreaterThanOrEqual(0);
    expect(run.indexOf("sha256sum --check")).toBeLessThan(run.indexOf("npm publish"));
    expect(run).toMatch(
      /npm publish \.\/handoff\/polaris-sdk\.tgz --provenance --access public --ignore-scripts /
    );
  });

  test("npm uses OIDC in its own environment with a pinned compatible toolchain", () => {
    expect(npm.environment).toBe("npm");
    expect(npm.steps[0]?.with?.["node-version"]).toBe("24.22.1");
    expect(npm.steps[2]?.run).toContain('test "$(npm --version)" = 11.19.1');
    expect(holdsSecrets(npm)).toBe(false);
    expect(JSON.stringify(npm)).not.toContain("NODE_AUTH_TOKEN");
  });
});

describe("Even G2 package", () => {
  const g2 = release.jobs["even-g2"]!;

  test("the .ehpk stays a workflow artifact: publish never downloads it", () => {
    const artifacts = g2.steps
      .filter((step) => step.uses?.startsWith("actions/upload-artifact@"))
      .map((step) => String(step.with?.name));

    const downloaded = release.jobs
      .publish!.steps.filter((step) => step.uses?.startsWith("actions/download-artifact@"))
      .map((step) => step.with);

    expect(artifacts).toEqual(["polaris-g2-${{ needs.metadata.outputs.version }}"]);
    expect(downloaded).toEqual([
      { name: "release-assets-macos-signed", path: "handoff/macos" },
      { name: "release-assets-dmg-signed", path: "handoff/dmg" },
      { name: "release-assets-windows", path: "handoff/windows" },
      { name: "release-assets-raycast", path: "handoff/raycast" },
    ]);
    expect(release.jobs.publish!.needs).not.toContain("even-g2");
  });

  test("the whitelist comes from the EVEN_G2_HOSTS variable through the environment, not the script", () => {
    const pack = g2.steps.find((step) => step.run?.includes("extensions/even-g2 pack"));

    expect(g2.if).toBe("vars.EVEN_G2_HOSTS != '' && inputs.channel != 'nightly'");
    expect(pack?.env?.EVEN_G2_HOSTS).toBe("${{ vars.EVEN_G2_HOSTS }}");
    expect(pack?.run).not.toContain("${{");
    expect(holdsSecrets(g2)).toBe(false);
  });
});

describe("release assets", () => {
  const publish = Object.values(release.jobs)
    .flatMap((job) => job.steps)
    .map((step) => step.run ?? "")
    .find((run) => run.includes("gh release create"));

  test("the Release carries one Daemon archive per platform the Client installs", () => {
    expect(publish).toContain(`test "\${#daemons[@]}" -eq ${PLATFORMS.length}`);
  });

  test("failed extension jobs leave the run red but do not block the signed Release", () => {
    expect(release.jobs.publish!.needs).toContain("raycast");
    expect(release.jobs.publish!.if?.trim()).toBe(
      "always() && needs.sign.result == 'success' && needs.sign-dmg.result == 'success'" +
        " && (inputs.channel != 'nightly' || needs.windows.result == 'success')"
    );
    expect(release.jobs.raycast!["continue-on-error"]).not.toBe(true);

    const draft = release.jobs.publish!.steps.find((step) =>
      step.run?.includes("gh release create")
    );

    for (const job of ["windows", "raycast"]) {
      expect(draft?.env?.[`${job.toUpperCase()}_SHA256`]).toBe(
        `\${{ needs.${job}.result == 'success' && needs.${job}.outputs.assets || '' }}`
      );
    }

    expect(
      release.jobs.publish!.steps.find((step) => step.with?.name === "release-assets-raycast")?.if
    ).toBe("needs.raycast.result == 'success'");
    expect(publish).toContain('take raycast "$RAYCAST_SHA256"');
    expect(publish).toContain('test -s "handoff/raycast/polaris-raycast-$VERSION.zip"');
  });

  test.each(PLATFORMS.filter((platform) => platform.startsWith("windows")))(
    "the Release refuses to publish without the %s Daemon",
    (platform) => {
      expect(publish).toContain(`polaris-daemon-$VERSION-${platform}.tar.gz`);
    }
  );
});

describe("nightly build", () => {
  test("runs on a schedule and by hand, never on a push or tag", () => {
    expect(Object.keys(nightly.on).toSorted()).toEqual(["schedule", "workflow_dispatch"]);
    expect(nightly.jobs.plan!.if).toBe("github.ref == 'refs/heads/main'");
  });

  test("reuses release.yml on the nightly channel at the tag's commit", () => {
    const call = nightly.jobs.release!;

    expect(call.uses).toBe("./.github/workflows/release.yml");
    expect(call.with).toEqual({
      tag: "${{ needs.plan.outputs.tag }}",
      channel: "nightly",
      sha: "${{ needs.tag.outputs.sha }}",
    });
  });

  test("passes the Apple secrets by name, never inherit; release.yml requires each of them", () => {
    expect(nightly.jobs.release!.secrets).toEqual(
      Object.fromEntries(APPLE_SECRETS.map((name) => [name, `\${{ secrets.${name} }}`]))
    );
    expect(
      Object.entries(nightly.jobs)
        .filter(([, job]) => holdsSecrets(job))
        .map(([name]) => name)
    ).toEqual(["release"]);

    const declared = Schema.decodeUnknownSync(
      Schema.Struct({
        workflow_call: Schema.Struct({
          secrets: Schema.Record(Schema.String, Schema.Struct({ required: Schema.Boolean })),
        }),
      })
    )(release.on).workflow_call.secrets;

    expect(declared).toEqual(
      Object.fromEntries(
        APPLE_SECRETS.map((name) => [name, { required: name !== "MACOS_SIGNING_IDENTITY" }])
      )
    );

    for (const [, job] of appleJobs()) {
      const used = [...JSON.stringify(job).matchAll(/secrets\.(\w+)/g)].map((match) => match[1]);

      expect(used).toEqual(APPLE_SECRETS);
    }
  });

  test("before anything is signed, metadata checks the nightly tag still names the commit, built on main", () => {
    const steps = release.jobs.metadata!.steps;
    const check = steps.find((step) => step.run?.includes("git/ref/tags"));

    expect(check?.if).toBe("inputs.channel == 'nightly'");
    expect(check?.shell).toBe("bash");
    expect(check?.env?.TAG_SHA).toBe("${{ inputs.sha }}");
    expect(check?.run).toContain("compare/$source...main");
    expect(release.jobs.build!.needs).toBe("metadata");
    expect(release.jobs.sign!.needs).toContain("build");
  });

  test("only tagging, the release and pruning write; nothing else gets a token beyond reading", () => {
    expect(nightly.permissions).toEqual({});
    expect(
      Object.entries(nightly.jobs).flatMap(([name, job]) =>
        writes(job).map(([scope]) => `${name}:${scope}`)
      )
    ).toEqual(["tag:contents", "release:contents", "release:id-token", "prune:contents"]);
  });

  test("a nightly tag is pushed once, never moved", () => {
    const script = readFileSync(join(import.meta.dir, "nightly.py"), "utf8");
    const pushes = script.split("\n").filter((line) => line.includes('"push"'));

    expect(pushes).toEqual(['    git("push", "origin", f"refs/tags/{tag}")']);
    expect(script).not.toMatch(/--force|"-f"|\+refs/);
  });

  test("jobs with a write token run only git and the stdlib nightly script, no packages", () => {
    for (const name of ["tag", "prune"]) {
      for (const step of nightly.jobs[name]!.steps ?? []) {
        if (step.uses !== undefined) expect(step.uses).toMatch(/^actions\/checkout@/);

        expect(step.run ?? "").not.toMatch(/\b(bunx?|node|npx?|uvx?|pip3?|pnpm|yarn|make)\b/);

        const commands = (step.run ?? "").replaceAll(/\\\n\s*/g, " ").split("\n");

        for (const command of commands.filter((line) => line.trim() !== ""))
          expect(command.trim()).toMatch(/^(python3 -I tooling\/release\/nightly\.py |git )/);
      }
    }
  });

  test("a nightly skips the SDK, npm, Raycast and Even G2 jobs, and still signs every build", () => {
    for (const name of ["sdk", "npm", "raycast", "even-g2"])
      expect(release.jobs[name]!.if).toContain("inputs.channel != 'nightly'");

    for (const name of ["metadata", "build", "sign", "dmg", "sign-dmg", "windows"])
      expect(release.jobs[name]!.if).toBeUndefined();
  });

  test("repository code is checked out at the tag's commit by SHA, and metadata checks it on its channel", () => {
    for (const [, job] of Object.entries(release.jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith("actions/checkout@") && step.with?.path !== "signer")
          expect(step.with?.ref).toBe("${{ inputs.sha }}");
      }
    }

    expect(release.jobs.metadata!.steps.find((step) => step.id === "metadata")?.env).toEqual({
      RELEASE_TAG: "${{ inputs.tag || github.ref_name }}",
      RELEASE_CHANNEL: "${{ inputs.channel }}",
    });
  });
});

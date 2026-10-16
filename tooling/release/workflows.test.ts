import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Schema } from "effect";

const GITHUB = join(import.meta.dir, "../../.github");

const Step = Schema.Struct({
  uses: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
  env: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  with: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});

const Job = Schema.Struct({
  environment: Schema.optional(Schema.String),
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  steps: Schema.Array(Step),
});

const Workflow = Schema.Struct({
  permissions: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  jobs: Schema.Record(Schema.String, Job),
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

/** A secret's value, as opposed to a `secrets.X != ''` presence check. */
const SECRET_VALUE = /secrets\.\w+\b(?!\s*!=)/;

const holdsSecrets = (job: typeof Job.Type) =>
  job.steps.some((step) =>
    Object.values(step.env ?? {}).some((value) => SECRET_VALUE.test(String(value)))
  );

const writes = (job: typeof Job.Type) =>
  Object.entries(job.permissions ?? {}).filter(([, level]) => level === "write");

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
  test("only the publish job can write, and it holds no secrets", () => {
    expect(release.permissions).toEqual({});
    expect(
      Object.entries(release.jobs).flatMap(([name, job]) =>
        writes(job).map(([scope]) => `${name}:${scope}`)
      )
    ).toEqual(["publish:contents"]);
    expect(holdsSecrets(release.jobs.publish!)).toBe(false);
  });

  test("jobs with Apple credentials run only the default branch's signer", () => {
    const signers = Object.entries(release.jobs).filter(([, job]) => holdsSecrets(job));

    expect(signers.map(([name]) => name)).toEqual(["sign", "sign-dmg"]);

    for (const [, job] of signers) {
      expect(job.environment).toBe("release");

      for (const step of job.steps) {
        if (step.uses !== undefined)
          expect(step.uses).toMatch(/^actions\/(checkout|download-artifact|upload-artifact)@/);

        if (step.uses?.startsWith("actions/checkout@"))
          expect(step.with?.ref).toBe("${{ github.event.repository.default_branch }}");

        expect(step.run ?? "").not.toMatch(/\b(bunx?|node|npx?|uvx?|pip3?|pnpm|yarn|make)\b/);
      }
    }
  });

  test("only the signing jobs enter the release environment, so a release asks for two approvals", () => {
    const gated = Object.entries(release.jobs).filter(([, job]) => job.environment !== undefined);

    expect(gated.map(([name]) => name)).toEqual(["sign", "sign-dmg"]);
  });

  test("jobs with Apple credentials touch hand-offs only through the signer", () => {
    for (const [, job] of Object.entries(release.jobs).filter(([, each]) => holdsSecrets(each))) {
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

/**
 * `bun:test` for the files that need Postgres (`postgres.ts`): without Docker or
 * `ACCOUNTS_TEST_DATABASE_URL` their tests skip, their hooks don't run, and the run says why.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";

export interface PostgresProbe {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly which: (command: string) => string | null;
  /** Whether the Docker server answers. */
  readonly dockerRuns: () => boolean;
}

const probe: PostgresProbe = {
  env: process.env,
  platform: process.platform,
  which: Bun.which,
  dockerRuns: () =>
    Bun.spawnSync(["docker", "version", "--format", "{{.Server.Version}}"], {
      stdout: "ignore",
      stderr: "ignore",
      timeout: 10_000,
    }).exitCode === 0,
};

/** Why the Postgres-backed tests can't run on this machine; null when they can. */
export const postgresUnavailable = (on: PostgresProbe = probe): string | null => {
  if (on.env["ACCOUNTS_TEST_DATABASE_URL"] !== undefined) return null;

  // CI's Linux runners have Docker: there a missing one fails the tests instead of skipping them.
  if (on.env["CI"] !== undefined && on.platform === "linux") return null;

  if (on.which("docker") === null) return "docker isn't on PATH";

  return on.dockerRuns() ? null : "Docker isn't running";
};

/** `test`, `describe` and the file's hooks, skipped together when there is no Postgres. */
export const postgresSuite = () => {
  const reason = postgresUnavailable();

  if (reason === null) return { afterAll, beforeAll, describe, test };

  console.warn(
    `Skipped: these tests need Postgres, and ${reason}. Start Docker, or set ACCOUNTS_TEST_DATABASE_URL to a Postgres admin URL.`
  );

  // bun runs a file's own hooks even when each of its tests is skipped.
  const noHook: typeof beforeAll = () => {};

  return {
    afterAll: noHook,
    beforeAll: noHook,
    describe: describe.skipIf(true),
    test: test.skipIf(true),
  };
};

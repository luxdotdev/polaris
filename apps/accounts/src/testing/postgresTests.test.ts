import { expect, test } from "bun:test";
import { postgresUnavailable, type PostgresProbe } from "./postgresTests.ts";

const machine = (over: Partial<PostgresProbe>): PostgresProbe => ({
  env: {},
  platform: "darwin",
  which: () => "/usr/local/bin/docker",
  dockerRuns: () => true,
  ...over,
});

test.each([
  ["Docker is installed and running", machine({}), null],
  ["docker is missing", machine({ which: () => null }), "docker isn't on PATH"],
  ["Docker is installed but stopped", machine({ dockerRuns: () => false }), "Docker isn't running"],
  [
    "a database URL is given, with no Docker",
    machine({ env: { ACCOUNTS_TEST_DATABASE_URL: "postgres://x" }, which: () => null }),
    null,
  ],
  [
    "CI's Linux runner has lost Docker, so the tests fail there rather than skip",
    machine({ env: { CI: "true" }, platform: "linux", which: () => null }),
    null,
  ],
  [
    "CI's macOS runner has no Docker",
    machine({ env: { CI: "true" }, which: () => null }),
    "docker isn't on PATH",
  ],
])("the Postgres tests' skip reason when %s", (_, on, reason) => {
  expect(postgresUnavailable(on)).toBe(reason);
});

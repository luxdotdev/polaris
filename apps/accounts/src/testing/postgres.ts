import { SQL } from "bun";

const CONTAINER = "polaris-accounts-test-pg";

const IMAGE = "postgres:17-alpine";

const PASSWORD = "polaris";

const docker = async (...args: Array<string>) => {
  if (Bun.which("docker") === null) return { out: "", err: "docker isn't on PATH", code: 127 };

  const proc = Bun.spawn(["docker", ...args], { stdout: "pipe", stderr: "pipe" });

  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { out: out.trim(), err: err.trim(), code };
};

const containerPort = async () => {
  const { out, code } = await docker("port", CONTAINER, "5432/tcp");

  if (code !== 0 || out === "") return undefined;

  return out.split("\n")[0]?.split(":").pop();
};

/** Starts (or reuses) a Postgres container for tests; returns its admin URL. */
const ensureContainer = async () => {
  let port = await containerPort();

  if (port === undefined) {
    const started = await docker("start", CONTAINER);

    if (started.code !== 0) {
      const run = await docker(
        "run",
        "-d",
        "--name",
        CONTAINER,
        "-e",
        `POSTGRES_PASSWORD=${PASSWORD}`,
        "-p",
        "127.0.0.1::5432",
        IMAGE
      );

      // Another test file may have created it first.
      if (run.code !== 0 && !run.err.includes("already in use")) {
        throw new Error(
          `The Account Server's slow tests need Docker, or ACCOUNTS_TEST_DATABASE_URL: ${run.err}`
        );
      }
    }

    port = await containerPort();
  }

  if (port === undefined) throw new Error("the test Postgres container published no port");
  const url = `postgres://postgres:${PASSWORD}@127.0.0.1:${port}/postgres`;

  for (let attempt = 0; ; attempt++) {
    const client = new SQL(url);

    try {
      await client`select 1`;
      await client.close();

      return url;
    } catch (error) {
      await client.close();

      if (attempt > 600) throw error;
      await Bun.sleep(50);
    }
  }
};

/**
 * A fresh database for one test file, on `ACCOUNTS_TEST_DATABASE_URL`'s server when set (an admin
 * URL), else on a Postgres container this starts and leaves running for the next run.
 */
export const freshDatabase = async () => {
  const admin = process.env["ACCOUNTS_TEST_DATABASE_URL"] ?? (await ensureContainer());
  const name = `accounts_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const client = new SQL(admin);
  await client.unsafe(`create database ${name}`);
  const url = new URL(admin);
  url.pathname = `/${name}`;

  return {
    url: url.toString(),
    drop: async () => {
      await client.unsafe(`drop database if exists ${name} with (force)`);
      await client.close();
    },
  };
};

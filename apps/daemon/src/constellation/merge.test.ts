import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Attempt, Constellation, ConstellationSettings } from "@polaris/protocol";
import { Effect, Struct } from "effect";
import { gitText } from "../git/git.ts";
import { commitAll, makeRepo, tempDir, write } from "../git/testing.ts";
import { AT, CID, HOST, LEAD, WS, draft, report } from "../engine/constellation.testing.ts";
import { mergeClaim } from "./merge.ts";

const GIT_WORK_MS = 15_000;

/** A Lead repository on main and a worker branch `polaris/A` with one commit touching `path`. */
const setup = async (path = "work.txt", content = "worker\n") => {
  const root = await makeRepo({ "README.md": "hello\n", "shared.txt": "base\n" });
  await gitText(root, ["checkout", "-q", "-b", "polaris/A"]);
  write(root, path, content);
  const head = await commitAll(root, "worker");
  await gitText(root, ["checkout", "-q", "main"]);

  const attempt = Attempt.make(
    Struct.assign(draft(), { state: "review" as const, claim: report("polaris/A", head) })
  );

  const graph = Constellation.make({
    id: CID,
    hostId: HOST,
    leadSessionId: LEAD,
    workspaceId: WS,
    name: "test",
    state: "running",
    revision: 1,
    settings: ConstellationSettings.make({}),
    tasks: [],
    attempts: [attempt],
    pendingNotifications: [],
    createdAt: AT,
    updatedAt: AT,
  });

  return { root, head, attempt, graph };
};

const merge = (s: Awaited<ReturnType<typeof setup>>, head = s.head) =>
  Effect.runPromise(
    mergeClaim(s.graph, s.attempt, s.root, head).pipe(
      Effect.match({ onFailure: (e) => ({ error: e }), onSuccess: (ok) => ({ ok }) })
    )
  );

const leadHead = (root: string) => gitText(root, ["rev-parse", "HEAD"]);

test(
  "Accept's merge makes a merge commit on a moved Lead branch without running the repository's hooks",
  async () => {
    const s = await setup();
    write(s.root, "lead.txt", "lead\n");
    const before = await commitAll(s.root, "lead moved on");
    const marker = join(s.root, "hook-ran");

    for (const hook of ["pre-merge-commit", "commit-msg", "post-merge"]) {
      write(s.root, `.git/hooks/${hook}`, `#!/bin/sh\ntouch "${marker}"\n`);
      chmodSync(join(s.root, `.git/hooks/${hook}`), 0o755);
    }

    const result = await merge(s);
    const after = await leadHead(s.root);

    expect(result).toEqual({ ok: { merged: true, leadHead: after } });
    expect(after).not.toBe(before);
    expect(await gitText(s.root, ["rev-parse", "HEAD^1", "HEAD^2"])).toBe(`${before}\n${s.head}`);
    expect(await gitText(s.root, ["log", "-1", "--format=%s"])).toBe("Merge polaris/A (A)");
    expect(readFileSync(join(s.root, "work.txt"), "utf8")).toBe("worker\n");
    expect(existsSync(marker)).toBe(false);
  },
  GIT_WORK_MS
);

test(
  "Accept's merge refuses a dirty or detached Lead checkout and names the step, leaving it as it was",
  async () => {
    const s = await setup();
    const before = await leadHead(s.root);
    write(s.root, "README.md", "edited by the lead\n");

    const dirty = await merge(s);

    expect(dirty).toMatchObject({ error: { code: "E-LEAD-DIRTY" } });
    expect("error" in dirty && dirty.error.message).toContain("README.md");
    expect("error" in dirty && dirty.error.fix).toContain(
      "Commit or stash them, then accept again"
    );
    expect(await leadHead(s.root)).toBe(before);
    expect(readFileSync(join(s.root, "README.md"), "utf8")).toBe("edited by the lead\n");

    await gitText(s.root, ["checkout", "-q", "--", "README.md"]);
    await gitText(s.root, ["checkout", "-q", "--detach"]);
    expect(await merge(s)).toMatchObject({ error: { code: "E-LEAD-DETACHED" } });
    expect(await leadHead(s.root)).toBe(before);
  },
  GIT_WORK_MS
);

test(
  "Accept's merge aborts a conflicting merge, names the files and the fix, and leaves the Lead clean",
  async () => {
    const s = await setup("shared.txt", "worker's line\n");
    write(s.root, "shared.txt", "lead's line\n");
    const before = await commitAll(s.root, "lead edits the same line");

    const result = await merge(s);

    expect(result).toMatchObject({ error: { code: "E-MERGE-CONFLICT" } });
    expect("error" in result && result.error.message).toContain("shared.txt");
    expect("error" in result && result.error.fix).toContain("mergeConflictBase main");
    expect(await leadHead(s.root)).toBe(before);
    expect(await gitText(s.root, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(s.root, ".git/MERGE_HEAD"))).toBe(false);
  },
  GIT_WORK_MS
);

describe("Accept's merge with commit.gpgSign", () => {
  const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_NOSYSTEM };
  let markers = "";

  beforeEach(() => {
    markers = tempDir("polaris-sign-");
    writeFileSync(join(markers, "gitconfig"), "");
    process.env.GIT_CONFIG_GLOBAL = join(markers, "gitconfig");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
  });

  afterEach(() => {
    for (const [key, value] of [
      ["GIT_CONFIG_GLOBAL", saved.global],
      ["GIT_CONFIG_NOSYSTEM", saved.system],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  /** A signing program that records its arguments in `name`, then signs or fails. */
  const signer = (name: string, signs: boolean) => {
    const path = join(markers, `${name}.sh`);

    const signature = signs
      ? 'printf -- "-----BEGIN PGP SIGNATURE-----\\nZmFrZQ==\\n-----END PGP SIGNATURE-----\\n"\n' +
        'echo "[GNUPG:] SIG_CREATED D 1 8 00 0 FAKE" >&2\n'
      : "exit 1\n";

    writeFileSync(
      path,
      `#!/bin/sh\necho "$@" >> "${join(markers, name)}"\ncat >/dev/null\n${signature}`
    );
    chmodSync(path, 0o755);

    return path;
  };

  const ran = (name: string) =>
    existsSync(join(markers, name)) ? readFileSync(join(markers, name), "utf8") : null;

  const hostConfig = (lines: string) => appendFileSync(join(markers, "gitconfig"), `${lines}\n`);

  /** The Lead moved on, so the merge makes a commit; then signing is asked for. */
  const diverged = async (repositorySigns: boolean) => {
    const s = await setup();
    write(s.root, "lead.txt", "lead\n");
    const before = await commitAll(s.root, "lead moved on");

    if (repositorySigns) await gitText(s.root, ["config", "commit.gpgsign", "true"]);
    else await gitText(s.root, ["config", "--unset", "commit.gpgsign"]);

    return { s, before };
  };

  const untouched = async (root: string, before: string) => {
    expect(await leadHead(root)).toBe(before);
    expect(await gitText(root, ["status", "--porcelain"])).toBe("");
    expect(existsSync(join(root, ".git/MERGE_HEAD"))).toBe(false);
  };

  test(
    "signs the merge commit with the program and key from the user's own git config",
    async () => {
      hostConfig(`[gpg]\n\tprogram = ${signer("host", true)}\n[user]\n\tsigningkey = HOSTKEY`);
      const { s, before } = await diverged(true);

      const result = await merge(s);

      expect(result).toEqual({ ok: { merged: true, leadHead: await leadHead(s.root) } });
      expect(await gitText(s.root, ["rev-parse", "HEAD^1", "HEAD^2"])).toBe(`${before}\n${s.head}`);
      expect(await gitText(s.root, ["cat-file", "-p", "HEAD"])).toContain(
        "gpgsig -----BEGIN PGP SIGNATURE-----"
      );
      expect(ran("host")).toContain("-bsau HOSTKEY");
    },
    GIT_WORK_MS
  );

  test.skipIf(Bun.which("ssh-keygen") === null)(
    "signs with the user's ssh key when their global config asks for signing",
    async () => {
      const key = join(markers, "key");
      const made = Bun.spawnSync(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key]);
      expect(made.exitCode).toBe(0);
      hostConfig(
        `[commit]\n\tgpgsign = true\n[gpg]\n\tformat = ssh\n[user]\n\tsigningkey = ${key}`
      );
      const { s } = await diverged(false);

      expect(await merge(s)).toMatchObject({ ok: { merged: true } });
      expect(await gitText(s.root, ["cat-file", "-p", "HEAD"])).toContain(
        "gpgsig -----BEGIN SSH SIGNATURE-----"
      );
    },
    GIT_WORK_MS
  );

  test.each([
    ["the repository's own gpg.program", "[gpg]\n\tprogram = PROGRAM", null],
    ["a file the repository's config includes", "[include]\n\tpath = signing.inc", null],
    ["a relative program path, which git resolves in the repository", "", "bin/gpg"],
  ])(
    "never runs a signing program from %s, and refuses with the fix",
    async (_, local, hostProgram) => {
      hostConfig(`[gpg]\n\tprogram = ${hostProgram ?? signer("host", true)}`);
      const { s, before } = await diverged(true);
      const evil = signer("repository", true);
      write(s.root, "bin/gpg", readFileSync(evil, "utf8"));
      chmodSync(join(s.root, "bin/gpg"), 0o755);
      appendFileSync(join(s.root, ".git/info/exclude"), "bin/\n");
      write(s.root, ".git/signing.inc", `[gpg]\n\tprogram = ${evil}\n`);
      appendFileSync(join(s.root, ".git/config"), `${local.replace("PROGRAM", evil)}\n`);

      const result = await merge(s);

      expect(result).toMatchObject({ error: { code: "E-MERGE-SIGN" } });
      expect("error" in result && result.error.fix).toBe(
        `Merge polaris/A at ${s.head} into main and sign it yourself, then accept with mergedHead ${s.head}.`
      );
      expect(ran("repository")).toBeNull();
      expect(ran("host")).toBeNull();
      await untouched(s.root, before);
    },
    GIT_WORK_MS
  );

  test(
    "a signing program that fails refuses with the fix and leaves the Lead's tree as it was",
    async () => {
      hostConfig(`[gpg]\n\tprogram = ${signer("host", false)}`);
      const { s, before } = await diverged(true);

      const result = await merge(s);

      expect(result).toMatchObject({ error: { code: "E-MERGE-SIGN" } });
      expect("error" in result && result.error.fix).toContain("and sign it yourself, then accept");
      expect(ran("host")).not.toBeNull();
      await untouched(s.root, before);
    },
    GIT_WORK_MS
  );
});

test(
  "Accept's merge refuses a head other than the claimed one and merges nothing",
  async () => {
    const s = await setup();
    const before = await leadHead(s.root);

    expect(await merge(s, before)).toMatchObject({ error: { code: "E-MERGED-HEAD" } });
    expect(await leadHead(s.root)).toBe(before);
  },
  GIT_WORK_MS
);

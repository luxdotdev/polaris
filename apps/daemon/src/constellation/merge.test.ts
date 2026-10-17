import { expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Attempt, Constellation, ConstellationSettings } from "@polaris/protocol";
import { Effect, Struct } from "effect";
import { gitText } from "../git/git.ts";
import { commitAll, makeRepo, write } from "../git/testing.ts";
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

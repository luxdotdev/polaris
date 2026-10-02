import { expect, test } from "bun:test";
import { readFile, writeFile, symlink, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "./testing.ts";
import { InjectedCrash } from "./index.ts";
import { currentVersion, sameVersion } from "../version.ts";

const renameChain = (f: Awaited<ReturnType<typeof fixture>>) => [
  { kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") },
  { kind: "rename", oldUri: f.uri("c"), newUri: f.uri("b"), options: { overwrite: true } },
];

test("ordered overwrite chain is durable, duplicate acceptance does not mutate, reverse undo preserves bytes and versions", async () => {
  const f = await fixture();

  try {
    const r = await f.request(renameChain(f));
    const api = f.coordinator();
    const result = await api.accept(f.owner, r.proposal, r.acceptance, r.drafts);
    expect(result.state).toBe("applied");
    expect(result.receiptDurable).toBe(true);
    expect(await readFile(join(f.root, "b"), "utf8")).toBe("alpha\r\n");
    expect(await api.accept(f.owner, r.proposal, r.acceptance, r.drafts)).toEqual(result);
    expect(await f.coordinator().get(f.owner, "operation")).toEqual(result);

    const restored = await f
      .coordinator()
      .recover(f.owner, "operation", result.receiptRevision, "undo");

    expect(restored.state).toBe("restored");
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
    expect(await readFile(join(f.root, "b"), "utf8")).toBe("beta");

    for (const snapshot of r.proposal.snapshots)
      expect(sameVersion(await currentVersion(snapshot.canonicalPath), snapshot.diskVersion)).toBe(
        true
      );
    expect(await api.accept(f.owner, r.proposal, r.acceptance, r.drafts)).toEqual(restored);
    expect(api.recover(f.owner, "operation", result.receiptRevision, "undo")).rejects.toThrow(
      "revision"
    );
  } finally {
    await f.cleanup();
  }
});

for (const point of ["intent", "mutation", "receipt"] as const) {
  for (const index of [0, 1, 2]) {
    test(`crash ${point}/${index}: restart query, duplicate retry and guarded reverse recovery`, async () => {
      const f = await fixture();

      try {
        const r = await f.request(renameChain(f));

        const api = f.coordinator(async (at, move) => {
          if (at === point && move === index) throw new InjectedCrash("crashed");
        });

        expect(api.accept(f.owner, r.proposal, r.acceptance, r.drafts)).rejects.toThrow("crashed");
        const restarted = f.coordinator();
        const known = (await restarted.get(f.owner, "operation"))!;
        expect(await restarted.accept(f.owner, r.proposal, r.acceptance, r.drafts)).toEqual(known);
        expect(
          (await restarted.recover(f.owner, "operation", known.receiptRevision, "recover")).state
        ).toBe("restored");
        expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
        expect(await readFile(join(f.root, "b"), "utf8")).toBe("beta");
        expect(await currentVersion(join(f.root, "c"))).toBe(null);
      } finally {
        await f.cleanup();
      }
    });
  }
}

for (const point of ["restore-intent", "restore-mutation"] as const) {
  test(`restart during ${point} resumes reverse recovery`, async () => {
    const f = await fixture();

    try {
      const r = await f.request(renameChain(f));
      const applied = await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts);
      expect(
        f
          .coordinator(async (at) => {
            if (at === point) throw new InjectedCrash("undo crash");
          })
          .recover(f.owner, "operation", applied.receiptRevision, "undo")
      ).rejects.toThrow("undo crash");
      const known = (await f.coordinator().get(f.owner, "operation"))!;
      expect(
        (await f.coordinator().recover(f.owner, "operation", known.receiptRevision, "recover"))
          .state
      ).toBe("restored");
    } finally {
      await f.cleanup();
    }
  });
}

test("partial failure and cancellation persist outcomes and recover only completed moves", async () => {
  for (const cancel of [false, true]) {
    const f = await fixture();

    try {
      const r = await f.request(renameChain(f));
      const controller = new AbortController();

      const api = f.coordinator(async (point, index) => {
        if (point === "intent" && index === 1) {
          if (cancel) controller.abort();
          else throw new Error("disk failure");
        }
      });

      const partial = await api.accept(
        f.owner,
        r.proposal,
        r.acceptance,
        r.drafts,
        controller.signal
      );

      expect(partial.state).toBe("partial");
      expect(partial.failedChange).toBe(1);
      expect(
        (await f.coordinator().recover(f.owner, "operation", partial.receiptRevision, "cancel"))
          .state
      ).toBe("restored");
    } finally {
      await f.cleanup();
    }
  }
});

for (const mode of ["write", "absent-target", "crash-write"] as const) {
  test(`${mode}: undo refuses intervening Agent/external versions`, async () => {
    const f = await fixture();

    try {
      const r = await f.request([{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") }]);

      if (mode === "crash-write")
        expect(
          f
            .coordinator(async (point) => {
              if (point === "mutation") throw new InjectedCrash();
            })
            .accept(f.owner, r.proposal, r.acceptance, r.drafts)
        ).rejects.toThrow();
      else await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts);
      const path = join(f.root, mode === "absent-target" ? "a" : "c");
      await writeFile(path, "intervening");
      const known = (await f.coordinator().get(f.owner, "operation"))!;
      expect(
        (await f.coordinator().recover(f.owner, "operation", known.receiptRevision, "undo")).state
      ).toBe("recovery-required");
      expect(await readFile(path, "utf8")).toBe("intervening");
    } finally {
      await f.cleanup();
    }
  });
}

test("create/delete, ignored no-ops and overwrite undo", async () => {
  const f = await fixture();

  try {
    const r = await f.request([
      { kind: "create", uri: f.uri("a"), options: { overwrite: true } },
      { kind: "delete", uri: f.uri("b") },
      { kind: "create", uri: f.uri("a"), options: { ignoreIfExists: true } },
      { kind: "delete", uri: f.uri("c"), options: { ignoreIfNotExists: true } },
    ]);

    const result = await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts);
    expect(result.state).toBe("applied");
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("");
    expect(await currentVersion(join(f.root, "b"))).toBe(null);
    expect(
      (await f.coordinator().recover(f.owner, "operation", result.receiptRevision, "undo")).state
    ).toBe("restored");
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});

test("stale snapshot, invalid operation chain, aliases and missing snapshots fail without mutation", async () => {
  for (const mode of ["stale", "chain", "alias", "missing"]) {
    const f = await fixture();

    try {
      const ops =
        mode === "chain"
          ? [
              { kind: "delete", uri: f.uri("a") },
              { kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") },
            ]
          : [{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri(mode === "alias" ? "a" : "c") }];

      const r = await f.request(ops, mode === "missing" ? ["a"] : undefined);

      if (mode === "stale") await writeFile(join(f.root, "a"), "new version");
      expect(
        (await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts)).state
      ).toBe("failed");
      expect(await readFile(join(f.root, "a"), "utf8")).toBe(
        mode === "stale" ? "new version" : "alpha\r\n"
      );
      const directories = await readdir(join(f.home, "journal"));
      expect(await readdir(join(f.home, "journal", directories[0]!))).toEqual(["receipt.json"]);
    } finally {
      await f.cleanup();
    }
  }
});

test("symlink, escape, directory and non-file URI rejection leaves fixtures untouched", async () => {
  const f = await fixture();

  try {
    await symlink(join(f.root, "a"), join(f.root, "link"));
    await mkdir(join(f.root, "directory"));

    for (const uri of [
      f.uri("link"),
      f.uri("directory"),
      f.uri("../outside"),
      "https://invalid/file",
    ]) {
      const r = await f.request([{ kind: "delete", uri }]);
      expect(
        f
          .coordinator()
          .accept(
            f.owner,
            r.proposal,
            { ...r.acceptance, operationId: `operation${uri.length}` },
            r.drafts
          )
      ).rejects.toThrow();
    }

    expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});

test("owner isolation, mismatched retries, durable drafts and acceptance fence enforcement", async () => {
  const f = await fixture();

  try {
    const r = await f.request([{ kind: "delete", uri: f.uri("a") }]);
    expect(
      f.coordinator().accept(f.owner, r.proposal, r.acceptance, { durable: false, groupId: null })
    ).rejects.toThrow("durable");
    expect(
      f.coordinator().accept({ ...f.owner, clientId: "other" }, r.proposal, r.acceptance, r.drafts)
    ).rejects.toThrow("owner");
    expect(
      f.coordinator().accept(f.owner, r.proposal, { ...r.acceptance, snapshots: [] }, r.drafts)
    ).rejects.toThrow("match");
    await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts);
    expect(
      f.coordinator().accept(f.owner, { ...r.proposal, label: "changed" }, r.acceptance, r.drafts)
    ).rejects.toThrow("different");
    expect(await f.coordinator().get({ ...f.owner, clientId: "other" }, "operation")).toBe(null);
  } finally {
    await f.cleanup();
  }
});

for (const point of ["prepared", "intent", "mutation", "receipt"] as const) {
  test(`SIGKILL at ${point} preserves receipt and permits version-guarded restart`, async () => {
    const f = await fixture();

    try {
      const r = await f.request([{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") }]);
      const input = join(f.home, "input.json");
      await writeFile(
        input,
        JSON.stringify({ journalRoot: join(f.home, "journal"), owner: f.owner, ...r, point })
      );

      const child = Bun.spawn([process.execPath, join(import.meta.dir, "crash-worker.ts"), input], {
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await child.exited).toBe(137);
      const known = (await f.coordinator().get(f.owner, "operation"))!;
      expect(known.receiptDurable).toBe(true);
      expect(
        (await f.coordinator().recover(f.owner, "operation", known.receiptRevision, "recover"))
          .state
      ).toBe("restored");
      expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
    } finally {
      await f.cleanup();
    }
  });
}

test("intervening mutation after intent is rejected and neither source nor destination is overwritten", async () => {
  const f = await fixture();

  try {
    const r = await f.request([{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") }]);

    const partial = await f
      .coordinator(async (point) => {
        if (point === "intent") await writeFile(join(f.root, "c"), "Agent intervened");
      })
      .accept(f.owner, r.proposal, r.acceptance, r.drafts);

    expect(partial.state).toBe("partial");
    expect(
      (await f.coordinator().recover(f.owner, "operation", partial.receiptRevision, "recover"))
        .state
    ).toBe("recovery-required");
    expect(await readFile(join(f.root, "c"), "utf8")).toBe("Agent intervened");
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});

test("mixed text/resource order retains original failedChange index and never writes draft text", async () => {
  const f = await fixture();

  try {
    const r = await f.request([
      {
        textDocument: { uri: f.uri("b"), version: null },
        edits: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: "draft",
          },
        ],
      },
      { kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") },
    ]);

    const result = await f
      .coordinator(async (point) => {
        if (point === "intent") throw new Error("failure");
      })
      .accept(f.owner, r.proposal, r.acceptance, r.drafts);

    expect(result.failedChange).toBe(1);
    expect(await readFile(join(f.root, "b"), "utf8")).toBe("beta");
  } finally {
    await f.cleanup();
  }
});

for (const point of ["intent", "mutation", "receipt"] as const) {
  for (let crashAt = 0; crashAt < 6; crashAt++) {
    test(`mixed create/overwrite/delete chain ${point}/${crashAt} restores original exact versions`, async () => {
      const f = await fixture();

      try {
        const r = await f.request([
          { kind: "create", uri: f.uri("a"), options: { overwrite: true } },
          { kind: "create", uri: f.uri("c") },
          { kind: "rename", oldUri: f.uri("c"), newUri: f.uri("a"), options: { overwrite: true } },
          { kind: "delete", uri: f.uri("b") },
        ]);

        const failed = await f
          .coordinator(async (at, index) => {
            if (at === point && index === crashAt) throw new InjectedCrash("crash");
          })
          .accept(f.owner, r.proposal, r.acceptance, r.drafts)
          .catch((cause: unknown) => cause);

        expect(failed).toBeInstanceOf(InjectedCrash);
        const known = (await f.coordinator().get(f.owner, "operation"))!;
        expect(
          (await f.coordinator().recover(f.owner, "operation", known.receiptRevision, "recover"))
            .state
        ).toBe("restored");

        for (const snapshot of r.proposal.snapshots)
          expect(
            sameVersion(await currentVersion(snapshot.canonicalPath), snapshot.diskVersion)
          ).toBe(true);
      } finally {
        await f.cleanup();
      }
    });
  }
}

test("concurrent overlapping acceptances share canonical mutation serialization", async () => {
  const f = await fixture();

  try {
    const r = await f.request([{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri("c") }]);

    const outcomes = await Promise.all([
      f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts),
      f
        .coordinator()
        .accept(f.owner, r.proposal, { ...r.acceptance, operationId: "second" }, r.drafts),
    ]);

    expect(outcomes.map((outcome) => outcome.state).sort()).toEqual(["applied", "failed"]);
    expect(await readFile(join(f.root, "c"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});

test("canonical parent symlink replacement after intent fails closed", async () => {
  const f = await fixture();

  try {
    await mkdir(join(f.root, "parent"));
    await mkdir(join(f.root, "other"));

    const r = await f.request(
      [{ kind: "rename", oldUri: f.uri("a"), newUri: f.uri("parent/c") }],
      ["a", "parent/c"]
    );

    const outcome = await f
      .coordinator(async (point) => {
        if (point === "intent") {
          const { rename } = await import("node:fs/promises");
          await rename(join(f.root, "parent"), join(f.root, "old-parent"));
          await symlink(join(f.root, "other"), join(f.root, "parent"));
        }
      })
      .accept(f.owner, r.proposal, r.acceptance, r.drafts);

    expect(outcome.state).toBe("partial");
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("alpha\r\n");
    expect(await currentVersion(join(f.root, "other/c"))).toBe(null);
    expect(
      (await f.coordinator().recover(f.owner, "operation", outcome.receiptRevision, "recover"))
        .state
    ).toBe("recovery-required");
  } finally {
    await f.cleanup();
  }
});

test("partial reverse recovery records restored steps and preserves an intervening source", async () => {
  const f = await fixture();

  try {
    const r = await f.request(renameChain(f));
    const applied = await f.coordinator().accept(f.owner, r.proposal, r.acceptance, r.drafts);
    await writeFile(join(f.root, "a"), "external");

    const outcome = await f
      .coordinator()
      .recover(f.owner, "operation", applied.receiptRevision, "undo");

    expect(outcome.state).toBe("recovery-required");
    expect(outcome.failedChange).toBe(0);
    expect(outcome.steps.map((step) => step.state)).toEqual(["conflict", "restored"]);
    expect(await readFile(join(f.root, "a"), "utf8")).toBe("external");
    expect(await readFile(join(f.root, "b"), "utf8")).toBe("beta");
    expect(await readFile(join(f.root, "c"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});

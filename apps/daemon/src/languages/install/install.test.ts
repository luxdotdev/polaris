import { test, expect } from "bun:test";
import { rejects } from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { Schema } from "effect";
import { LanguageInstallProgress } from "@polaris/protocol";
import { createInstaller } from "./index.ts";
import { artifactFixture, fixture, hostId, platform } from "./fixture.testing.ts";
import type { ArtifactPayload, Progress } from "./types.ts";

async function rejected(promise: Promise<unknown>, reason: string) {
  await rejects(promise, (cause: unknown) =>
    Schema.is(Schema.Struct({ reason: Schema.Literal(reason) }))(cause)
  );
}

test("deduplicates exact jobs, retains notices/metadata, observes monotonic isolated progress and restarts", async () => {
  const f = await fixture();

  try {
    const events: Progress[] = [];

    const off = f.installer.subscribe((event) => {
      expect(Schema.is(LanguageInstallProgress)(event)).toBe(true);
      events.push(event);
    });

    f.installer.subscribe(() => {
      throw new Error("observer failure");
    });
    const a = f.installer.install(f.request);
    const b = f.installer.install(f.request);
    expect(a.jobId).toBe(b.jobId);
    const [one, two] = await Promise.all([a.result, b.result]);
    expect(one).toEqual(two);
    expect(f.counts()).toEqual({ downloads: 1, decodes: 1 });
    expect(await readFile(join(one.directory, "LICENSE"))).toEqual(
      Buffer.from(f.source.payload.entries[1]!.bytes)
    );
    expect(one.descriptor.developerCompanions).toEqual(f.source.tool.developerCompanions);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1)?.phase).toBe("completed");
    off();
    expect(await f.debris()).toEqual([]);
    expect((await f.installer.install(f.request).result).identity).toBe(one.identity);
    expect(f.counts().downloads).toBe(1);
    await f.installer.dispose();

    const fresh = await createInstaller({
      root: join(f.parent, "private"),
      hostId,
      platform,
      adapters: {
        download() {
          throw new Error("no download");
        },
        async decode() {
          throw new Error("no decode");
        },
      },
    });

    expect(await fresh.current("fake-tool")).toEqual(one);
    await fresh.dispose();
  } finally {
    await f.close();
  }
});

test("default deny, wrong exact approval, pending audit and evaluation never download", async () => {
  for (const approve of [
    undefined,
    async () => ({ approved: false, identity: "wrong" }),
    async () => ({ approved: true, identity: "wrong" }),
  ]) {
    const f = await fixture(approve ? { approve } : {});

    try {
      if (!approve) {
        await f.installer.dispose();

        const denied = await createInstaller({
          root: join(f.parent, "deny"),
          hostId,
          platform,
          adapters: {
            download() {
              throw new Error("must not download");
            },
            async decode() {
              throw new Error("must not decode");
            },
          },
        });

        await rejected(denied.install(f.request).result, "audit-required");
        await denied.dispose();
      } else await rejected(f.installer.install(f.request).result, "audit-required");
      expect(f.counts().downloads).toBe(0);
    } finally {
      await f.close();
    }
  }

  const f = await fixture();

  try {
    expect(() =>
      f.installer.install({ ...f.request, tool: { ...f.source.tool, disposition: "evaluation" } })
    ).toThrow();
    expect(() => f.installer.install({ ...f.request, connected: false })).toThrow();
    expect(() =>
      f.installer.install({ ...f.request, tool: { ...f.source.tool, artifacts: [] } })
    ).toThrow();
    const pending = structuredClone(f.source.tool);
    pending.artifacts[0]!.audit = "pending";
    expect(() => f.installer.install({ ...f.request, tool: pending })).toThrow();
    expect(f.counts().downloads).toBe(0);
  } finally {
    await f.close();
  }
});

test("failed explicit updates preserve working bytes and remove only own staging; rollback is explicit and approved", async () => {
  let source = artifactFixture();
  let offline = false;

  const f = await fixture({
    async *download() {
      if (offline) throw new Error("offline");
      yield source.bytes;
    },
    async decode() {
      return source.payload;
    },
  });

  try {
    const one = await f.installer.install(f.request).result;
    source = artifactFixture("2.0.0");
    const update = { ...f.request, tool: source.tool, intent: "update" } as const;
    await rejected(f.installer.install({ ...update, intent: "encounter" }).result, "conflict");
    offline = true;
    await rejected(f.installer.install(update).result, "install-failed");
    expect((await f.installer.current("fake-tool"))?.identity).toBe(one.identity);
    offline = false;
    const two = await f.installer.install(update).result;
    expect(two.version).toBe("2.0.0");
    expect((await f.installer.versions("fake-tool")).length).toBe(2);
    const rolled = await f.installer.rollback(f.request).result;
    expect(rolled.identity).toBe(one.identity);
    expect(await readFile(join(one.directory, "bin/tool"), "utf8")).toBe("fake-tool-1.0.0");
    expect(await f.debris()).toEqual([]);
  } finally {
    await f.close();
  }
});

test("corrupt bytes, missing/tampered notices, pinned manifest mismatch and entry omissions are denied", async () => {
  const mutations: Array<(p: ArtifactPayload) => ArtifactPayload> = [
    (p) => ({ ...p, entries: p.entries.filter((e) => e.path !== "LICENSE") }),
    (p) => ({
      ...p,
      entries: p.entries.map((e) =>
        e.path === "LICENSE" ? { ...e, bytes: Buffer.from("tampered") } : e
      ),
    }),
    (p) => ({ ...p, manifestBytes: Buffer.from("{}") }),
    (p) => ({ ...p, entries: p.entries.filter((e) => e.path !== "bin/tool") }),
  ];

  for (const mutation of mutations) {
    const f = await fixture({
      async decode() {
        return mutation(artifactFixture().payload);
      },
    });

    try {
      await rejects(f.installer.install(f.request).result);
      expect(await f.installer.current("fake-tool")).toBe(null);
      expect(await f.debris()).toEqual([]);
    } finally {
      await f.close();
    }
  }

  const f = await fixture({
    async *download() {
      yield Buffer.from("corrupt");
    },
  });

  try {
    await rejected(f.installer.install(f.request).result, "audit-required");
    expect(f.counts().decodes).toBe(0);
  } finally {
    await f.close();
  }
});

test("path traversal, absolute paths, links, duplicates, case aliases, prefix collision and special modes fail before writes", async () => {
  for (const path of [
    "../escape",
    "/escape",
    "C:/escape",
    "bin/../escape",
    "bin\\escape",
    "./escape",
    "a//b",
    "a/./b",
    "a\0b",
  ]) {
    const f = await fixture({
      async decode() {
        const p = artifactFixture().payload;

        return {
          ...p,
          entries: [
            ...p.entries,
            { path, kind: "file", mode: 0o644, bytes: Buffer.from("escape") },
          ],
        };
      },
    });

    try {
      await rejected(f.installer.install(f.request).result, "install-failed");
      expect(await f.debris()).toEqual([]);
    } finally {
      await f.close();
    }
  }

  for (const entry of [
    { path: "link", kind: "symlink", mode: 0o777 },
    { path: "hard", kind: "hardlink", mode: 0o644 },
    { path: "bin/tool", kind: "file", mode: 0o644 },
    { path: "BIN/TOOL", kind: "file", mode: 0o644 },
    { path: "bin", kind: "file", mode: 0o644 },
    { path: "unsafe", kind: "file", mode: 0o4755 },
  ] as const) {
    const f = await fixture({
      async decode() {
        const p = artifactFixture().payload;

        return { ...p, entries: [...p.entries, { ...entry, bytes: Buffer.from("../escape") }] };
      },
    });

    try {
      await rejected(f.installer.install(f.request).result, "install-failed");
      expect(await f.debris()).toEqual([]);
    } finally {
      await f.close();
    }
  }
});

test("bounded downloads, files, expansion, entry counts and manifests reject", async () => {
  for (const limits of [
    { downloadBytes: 1 },
    { fileBytes: 1 },
    { expandedBytes: 1 },
    { entries: 1 },
    { metadataBytes: 2000 },
  ]) {
    const f = await fixture(
      limits.metadataBytes
        ? {
            async decode() {
              return { ...artifactFixture().payload, manifestBytes: new Uint8Array(2001) };
            },
          }
        : {},
      limits
    );

    try {
      await rejected(f.installer.install(f.request).result, "too-large");
      expect(await f.debris()).toEqual([]);
    } finally {
      await f.close();
    }
  }
});

test("consumer cancellation leaves peers working; last cancellation/disposal/deadline clean own resources", async () => {
  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const f = await fixture({
    async *download() {
      await held;
      yield artifactFixture().bytes;
    },
  });

  try {
    const a = f.installer.install(f.request);
    const b = f.installer.install(f.request);
    const rejectedA = rejected(a.result, "cancelled");
    a.cancel();
    await rejectedA;
    release();
    expect((await b.result).version).toBe("1.0.0");
    expect(await f.debris()).toEqual([]);
  } finally {
    await f.close();
  }

  for (const mode of ["cancel", "dispose", "deadline"] as const) {
    const f = await fixture(
      {
        decode(_bytes, _exact, signal) {
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(new Error("transport aborted")), {
              once: true,
            });
          });
        },
      },
      { timeoutMs: 100 }
    );

    try {
      const handle = f.installer.install(f.request);
      const observed = rejected(handle.result, mode === "deadline" ? "timeout" : "cancelled");

      if (mode === "cancel") handle.cancel();

      if (mode === "dispose") await f.installer.dispose();
      await observed;
      await f.installer.dispose();
      expect(f.installer.stats().jobs).toBe(0);
      expect(f.installer.stats().waiters).toBe(0);
      expect(await f.debris()).toEqual([]);
    } finally {
      await f.close();
    }
  }
});

test("approval revocation, pointer publication failure and cancellation of staged updates retain working version", async () => {
  let source = artifactFixture();
  let denied = false;
  let calls = 0;
  let breakPointer: (() => Promise<void>) | undefined;

  const f = await fixture({
    async *download() {
      yield source.bytes;
    },
    async decode() {
      return source.payload;
    },
    async approve(exact) {
      calls++;

      if (breakPointer && calls % 2 === 0) await breakPointer();

      return { approved: !denied || calls % 2 !== 0, identity: exact.identity };
    },
  });

  try {
    const one = await f.installer.install(f.request).result;
    const toolDirectory = dirname(dirname(dirname(one.directory)));
    const unrelated = join(toolDirectory, "unrelated-user-file");
    await writeFile(unrelated, "preserve");
    source = artifactFixture("2.0.0");
    denied = true;
    const update = { ...f.request, tool: source.tool, intent: "update" } as const;
    await rejected(f.installer.install(update).result, "audit-required");
    expect((await f.installer.current("fake-tool"))?.identity).toBe(one.identity);
    denied = false;
    const active = join(toolDirectory, "active.json");
    const activeBytes = await readFile(active);
    breakPointer = async () => {
      await rm(active);
      await mkdir(active);
    };

    await rejected(f.installer.install(update).result, "install-failed");
    breakPointer = undefined;
    await rm(active, { recursive: true });
    await writeFile(active, activeBytes, { mode: 0o600 });
    expect((await f.installer.current("fake-tool"))?.identity).toBe(one.identity);

    const off = f.installer.subscribe((p) => {
      if (p.phase === "activating") handle.cancel();
    });

    const handle = f.installer.install(update);
    await rejected(handle.result, "cancelled");
    off();
    await f.installer.dispose();
    expect((await f.installer.current("fake-tool"))?.identity).toBe(one.identity);
    expect((await f.installer.versions("fake-tool")).length).toBe(1);
    expect(await readFile(unrelated, "utf8")).toBe("preserve");
    expect(await f.debris()).toEqual([]);
    await writeFile(join(one.directory, "bin/tool"), "corruption");
    await rejected(f.installer.current("fake-tool"), "install-failed");
  } finally {
    await f.close();
  }
});

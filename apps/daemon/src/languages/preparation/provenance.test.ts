import { test, expect } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema, Effect } from "effect";
import { HostProposalEvidence } from "./provenance.ts";
import { ProposalProvenance } from "./provenanceService.ts";

const proposal = () =>
  P.LanguageTreeEditProposal.make({
    format: 2,
    proposalId: "issued",
    origin: "rename",
    label: "Rename",
    expiresAt: 10000,
    fence: P.LanguageRequestFence.make({
      context: P.LanguageContextIdentity.make({
        hostId: P.HostId.make("host"),
        clientId: "client",
        contextId: "context",
        providerId: "provider",
        projectRoot: "/fixture",
        generation: 1,
        configurationFingerprint: "a".repeat(64),
        checkout: P.LanguageCheckout.cases.Workspace.make({
          workspaceId: P.WorkspaceId.make("workspace"),
          path: "/fixture",
        }),
      }),
      requiredSequence: 1,
      documents: [{ uri: "file:///fixture/a", version: 7 }],
    }),
    edit: {
      documentChanges: [
        { kind: "rename", oldUri: "file:///fixture/a", newUri: "file:///fixture/b" },
      ],
    },
    snapshots: [
      {
        uri: "file:///fixture/a",
        canonicalPath: "/fixture/a",
        diskText: "private",
        diskVersion: new P.FileVersion({ mtimeMs: 1, size: 7, hash: "a".repeat(64) }),
        buffer: null,
      },
    ],
    resourceSnapshots: [
      {
        uri: "file:///fixture/a",
        canonicalPath: "/fixture/a",
        tree: {
          format: 1,
          entries: [
            {
              relativePath: "",
              kind: "file",
              identity: { device: 1, inode: 2, mode: 420 },
              version: new P.FileVersion({ mtimeMs: 1, size: 7, hash: "a".repeat(64) }),
            },
          ],
        },
      },
      { uri: "file:///fixture/b", canonicalPath: "/fixture/b", tree: null },
    ],
  });

const refused = async (promise: Promise<void>) => {
  try {
    await promise;
    throw new Error("Expected refusal");
  } catch (cause) {
    expect(cause).toBeInstanceOf(P.LanguageError);
    expect(String(cause)).not.toContain("private");
  }
};

const gate = () => {
  let release = () => {};

  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });

  return { promise, release };
};

test("domain FileVersion survives strict fingerprint; foreign/unissued/altered proposals refuse", async () => {
  const evidence = new HostProposalEvidence(() => 0);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const value = proposal();
  await refused(evidence.verify(owner, value));
  await evidence.record(owner, value, async () => {});
  await evidence.verify(owner, value);
  const wire = Schema.encodeSync(P.LanguageTreeEditProposal)(value);
  await evidence.verify(owner, Schema.decodeUnknownSync(P.LanguageTreeEditProposal)(wire));
  await refused(evidence.verify({ ...owner }, value));

  for (const altered of [
    { ...value, label: "different" },
    { ...value, expiresAt: 9000 },
    { ...value, fence: { ...value.fence, context: { ...value.fence.context, generation: 2 } } },
    {
      ...value,
      resourceSnapshots: [
        { ...value.resourceSnapshots[0]!, tree: null },
        value.resourceSnapshots[1]!,
      ],
    },
    {
      ...value,
      edit: { documentChanges: [{ kind: "delete" as const, uri: "file:///fixture/a" }] },
    },
  ])
    await refused(evidence.verify(owner, altered));
  evidence.dispose();
});

test("versionless resource metadata never falls through legacy; text-only domain instances work", async () => {
  const evidence = new HostProposalEvidence(() => 0);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const value = proposal();
  const legacy = P.LanguageEditProposal.make(value);
  await refused(evidence.record(owner, legacy, async () => {}));
  await refused(evidence.record(owner, { ...value, resourceSnapshots: [] }, async () => {}));

  const text = P.LanguageEditProposal.make({
    ...legacy,
    edit: { changes: { "file:///fixture/a": [] } },
  });

  await evidence.record(owner, text, async () => {});
  await evidence.verify(owner, text);
  evidence.dispose();
});

test("owner replacement during await and disconnect revocation reject admission", async () => {
  const evidence = new HostProposalEvidence(() => 0);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const value = proposal();
  let current = true;

  const validate = async () => {
    if (!current) throw new Error("private owner data");
  };

  await evidence.record(owner, value, validate);
  current = false;
  await refused(evidence.verify(owner, value));
  await refused(evidence.record(owner, value, async () => {}));
  current = true;
  const held = gate();
  const pending = evidence.record(owner, { ...value, proposalId: "late" }, () => held.promise);
  evidence.revoke(owner);
  held.release();
  await refused(pending);
  await refused(evidence.verify(owner, value));
  evidence.dispose();
});

test("verification checks captured authority and record identity again after waits", async () => {
  const evidence = new HostProposalEvidence(() => 0);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const value = proposal();
  let held: Promise<void> = Promise.resolve();
  let current = true;
  await evidence.record(owner, value, async () => {
    await held;

    if (!current) throw new Error("private");
  });
  const wait = gate();
  held = wait.promise;
  const pending = evidence.verify(owner, value);
  current = false;
  wait.release();
  await refused(pending);
  current = true;
  held = Promise.resolve();
  const wait2 = gate();
  held = wait2.promise;
  const revoked = evidence.verify(owner, value);
  evidence.revoke(owner);
  wait2.release();
  await refused(revoked);
  evidence.dispose();
});

test("expiry and bounded demand eviction fail closed without timers", async () => {
  let now = 0;
  const evidence = new HostProposalEvidence(() => now);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const value = proposal();
  await evidence.record(owner, value, async () => {});
  now = 10000;
  await refused(evidence.verify(owner, value));
  now = 0;
  await refused(evidence.record(owner, { ...value, expiresAt: 60001 }, async () => {}));

  for (let i = 0; i < 129; i++)
    await evidence.record(owner, { ...value, proposalId: String(i) }, async () => {});
  await refused(evidence.verify(owner, { ...value, proposalId: "0" }));
  await evidence.verify(owner, { ...value, proposalId: "128" });
  evidence.dispose();
  await refused(evidence.record(owner, value, async () => {}));
});

test("owning Effect Layer exposes admission and scoped cleanup", async () => {
  const value = { ...proposal(), expiresAt: Date.now() + 10000 };
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };

  const retained = await Effect.runPromise(
    Effect.gen(function* () {
      const evidence = yield* ProposalProvenance;
      yield* evidence.record(owner, value, async () => {});
      yield* evidence.verify(owner, value);
      yield* evidence.revoke(owner);
      const outcome = yield* Effect.exit(evidence.verify(owner, value));
      expect(outcome._tag).toBe("Failure");

      return evidence;
    }).pipe(Effect.provide(ProposalProvenance.layer))
  );

  await refused(
    Effect.runPromise(
      retained.record({ ...owner }, { ...value, proposalId: "new-after-scope" }, async () => {})
    )
  );
});

test("aborted preparation cannot publish evidence after a held validator settles", async () => {
  const evidence = new HostProposalEvidence(() => 0);
  const owner = { hostId: P.HostId.make("host"), clientId: "client" };
  const held = gate();
  const controller = new AbortController();
  const value = proposal();
  const pending = evidence.record(owner, value, () => held.promise, controller.signal);
  controller.abort();
  held.release();
  await refused(pending);
  await refused(evidence.verify(owner, value));
  evidence.dispose();
});

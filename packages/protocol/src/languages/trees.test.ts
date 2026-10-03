import { LanguageCheckout } from "./base.ts";
import { HostId, WorkspaceId } from "../ids.ts";
import { LanguageEditProposal } from "./edits.ts";
import { expect, test } from "bun:test";
import { Schema } from "effect";
import { LanguageTreeManifest, LanguageResourceSnapshot } from "./trees.ts";

const identity = { device: 1, inode: 2, mode: 0o755 };

const directory = (relativePath: string) => ({
  relativePath,
  kind: "directory",
  identity,
  version: null,
});

const file = (relativePath: string, size = 1) => ({
  relativePath,
  kind: "file",
  identity,
  version: { size, mtimeMs: 1, hash: "a".repeat(64) },
});

const valid = (entries: unknown[]) => {
  try {
    Schema.decodeUnknownSync(LanguageTreeManifest)({ format: 1, entries });

    return true;
  } catch {
    return false;
  }
};

test("tree manifest owns root and deterministic complete descendants", () => {
  expect(valid([directory(""), directory("a"), file("a/b")])).toBe(true);
  expect(valid([file("")])).toBe(true);
  expect(
    Schema.is(LanguageResourceSnapshot)({
      uri: "file:///absent",
      canonicalPath: "/absent",
      tree: null,
    })
  ).toBe(true);
});

test("unsafe, duplicate, unsorted, missing-parent and unsupported entries fail closed", () => {
  for (const entries of [
    [],
    [file("a")],
    [directory(""), file("../a")],
    [directory(""), file("/a")],
    [directory(""), file("a\\b")],
    [directory(""), file("a/b")],
    [directory(""), file("b"), file("a")],
    [directory(""), file("a"), file("a")],
    [directory(""), { ...file("a"), kind: "symlink" }],
    [{ ...directory(""), version: file("").version }],
  ])
    expect(valid(entries)).toBe(false);
});

test("entries, depth, bytes, modes, identity and versions are bounded", () => {
  expect(valid([directory(""), file("a", 67108865)])).toBe(false);
  expect(
    valid(
      Array.from({ length: 4097 }, (_, i) =>
        directory(i === 0 ? "" : `a${String(i).padStart(5, "0")}`)
      )
    )
  ).toBe(false);
  expect(valid([{ ...directory(""), identity: { ...identity, mode: 65535 } }])).toBe(false);
  expect(valid([{ ...file(""), version: { ...file("").version, hash: "bad" } }])).toBe(false);
  expect(valid([{ ...directory(""), identity: { ...identity, inode: -1 } }])).toBe(false);
});

test("depth boundary includes every parent", () => {
  const entries = [directory("")];
  let path = "";

  for (let depth = 1; depth <= 64; depth++) {
    path = path ? `${path}/a` : "a";
    entries.push(directory(path));
  }

  expect(valid(entries)).toBe(true);
  expect(valid([...entries, directory(`${path}/a`)])).toBe(false);
});

import {
  LanguageTreeEditProposal,
  LanguageTreeEditAcceptance,
  LanguageTreeDraftReceipt,
  LanguageTreeOperationOutcome,
  decodeLanguageResourceProposal,
  decodeLanguageResourceAcceptance,
} from "./trees.ts";
import { LanguageServerRequestPayload } from "./broker.ts";

const fence = {
  context: {
    hostId: HostId.make("fake-host"),
    clientId: "client",
    checkout: LanguageCheckout.cases.Workspace.make({
      workspaceId: WorkspaceId.make("workspace"),
      path: "/checkout",
    }),
    contextId: "context",
    providerId: "provider",
    projectRoot: "/checkout",
    generation: 1,
    configurationFingerprint: "a".repeat(64),
  },
  requiredSequence: 0,
  documents: [],
};

const regular = LanguageEditProposal.make({
  proposalId: "proposal",
  fence,
  origin: "rename",
  label: "Fixture",
  expiresAt: 1000,
  edit: { documentChanges: [] },
  snapshots: [],
});

const resources = [
  {
    uri: "file:///checkout/a",
    canonicalPath: "/checkout/a",
    tree: { format: 1, entries: [directory(""), file("a")] },
  },
];

const proposal = Schema.decodeUnknownSync(LanguageTreeEditProposal)({
  ...regular,
  format: 2,
  resourceSnapshots: resources,
});

test("dedicated server tree edit payload preserves resource snapshots before legacy decoding", () => {
  const payload = LanguageServerRequestPayload.cases.TreeApplyEdit.make({ proposal });

  expect(payload).toEqual(LanguageServerRequestPayload.cases.TreeApplyEdit.make({ proposal }));
  expect(() =>
    Schema.decodeUnknownSync(LanguageServerRequestPayload)({
      ...LanguageServerRequestPayload.cases.ApplyEdit.make({ proposal: regular }),
      proposal,
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageServerRequestPayload)({
      ...LanguageServerRequestPayload.cases.TreeApplyEdit.make({ proposal }),
      proposal: regular,
    })
  ).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(LanguageServerRequestPayload)({
      ...LanguageServerRequestPayload.cases.TreeApplyEdit.make({ proposal }),
      proposal: { ...proposal, format: 3 },
    })
  ).toThrow();
});

const acceptance = {
  format: 2,
  proposalId: "proposal",
  operationId: "operation",
  fence,
  snapshots: [],
  resourceSnapshots: resources,
  decision: "accept",
};

const receipt = {
  format: 2,
  durable: true,
  groupId: "draft-group",
  previewFingerprint: "a".repeat(64),
  resourceSnapshots: resources,
  descendants: [],
};

const decoded = <A extends Schema.ConstraintDecoder<unknown>, Input>(schema: A, input: Input) => {
  try {
    Schema.decodeUnknownSync(schema)(input);

    return true;
  } catch {
    return false;
  }
};

test("versioned preview/acceptance roundtrip retains complete ownership; legacy routing stays compatible", () => {
  const tree = Schema.decodeUnknownSync(LanguageTreeEditProposal)(
    decodeLanguageResourceProposal(JSON.parse(JSON.stringify(proposal)))
  );

  expect(tree.resourceSnapshots[0]?.tree?.entries[1]?.relativePath).toBe("a");
  expect(decodeLanguageResourceAcceptance(JSON.parse(JSON.stringify(acceptance)))).toEqual(
    Schema.decodeUnknownSync(LanguageTreeEditAcceptance)(acceptance)
  );
  expect(decodeLanguageResourceProposal(regular)).toEqual(
    Schema.decodeUnknownSync(LanguageEditProposal)(regular)
  );

  for (const invalid of [
    { ...proposal, format: 1 },
    { ...regular, resourceSnapshots: resources },
    {
      ...proposal,
      resourceSnapshots: [{ ...resources[0], tree: { format: 1, entries: [file("../bad")] } }],
    },
  ])
    expect(() => decodeLanguageResourceProposal(invalid)).toThrow();

  for (const invalid of [
    { ...acceptance, format: 3 },
    { ...acceptance, format: undefined },
    { ...acceptance, resourceSnapshots: [{ ...resources[0], tree: { format: 1, entries: [] } }] },
  ])
    expect(() => decodeLanguageResourceAcceptance(invalid)).toThrow();
});

test("aggregate roots/entries/hash bytes/UTF8 encoded bytes and all complete receipts are bounded", () => {
  const snapshot = (index: number, entries: unknown[]) => ({
    uri: `file:///checkout/a${index}`,
    canonicalPath: `/checkout/a${index}`,
    tree: { format: 1, entries },
  });

  const entries = [
    directory(""),
    ...Array.from({ length: 2200 }, (_, index) => file(`a${String(index).padStart(5, "0")}`, 0)),
  ];

  expect(
    decoded(LanguageTreeEditProposal, {
      ...proposal,
      resourceSnapshots: [snapshot(0, entries), snapshot(1, entries)],
    })
  ).toBe(false);
  expect(
    decoded(LanguageTreeEditProposal, {
      ...proposal,
      resourceSnapshots: [snapshot(0, [file("", 40000000)]), snapshot(1, [file("", 40000000)])],
    })
  ).toBe(false);
  expect(
    decoded(LanguageTreeEditProposal, {
      ...proposal,
      resourceSnapshots: Array.from({ length: 129 }, (_, index) =>
        snapshot(index, [directory("")])
      ),
    })
  ).toBe(false);

  const unicodeEntries = [
    directory(""),
    ...Array.from({ length: 300 }, (_, index) =>
      file(`${String(index).padStart(5, "0")}-${"λ".repeat(1000)}`, 0)
    ),
  ];

  expect(
    decoded(LanguageTreeEditProposal, {
      ...proposal,
      resourceSnapshots: [snapshot(0, unicodeEntries), snapshot(1, unicodeEntries)],
    })
  ).toBe(false);
  expect(
    decoded(LanguageTreeEditAcceptance, {
      ...acceptance,
      resourceSnapshots: [snapshot(0, unicodeEntries), snapshot(1, unicodeEntries)],
    })
  ).toBe(false);
  expect(
    decoded(LanguageTreeDraftReceipt, {
      ...receipt,
      resourceSnapshots: [snapshot(0, unicodeEntries), snapshot(1, unicodeEntries)],
    })
  ).toBe(false);
  const descendant = { canonicalPath: "/checkout/a", version: 1, draftRevision: 1 };
  expect(
    decoded(LanguageTreeDraftReceipt, { ...receipt, descendants: [descendant, descendant] })
  ).toBe(false);

  const step = {
    index: 0,
    operation: { kind: "delete", uri: "file:///checkout/a" },
    state: "prepared",
    before: [{ path: "/checkout/a", tree: { format: 1, entries: unicodeEntries } }],
    owned: [],
    message: "Prepared",
  };

  const outcome = {
    format: 2,
    operationId: "operation",
    proposalId: "proposal",
    owner: {
      hostId: HostId.make("fake-host"),
      clientId: "client",
      checkout: fence.context.checkout,
    },
    state: "prepared",
    draftsDurable: true,
    receiptDurable: true,
    receiptRevision: 1,
    draftGroupId: "group",
    steps: [step, { ...step, index: 1 }],
    failedChange: null,
    message: "Prepared",
  };

  expect(decoded(LanguageTreeOperationOutcome, outcome)).toBe(false);
});

import { LanguageTreeEditDecision } from "./trees.ts";
import { DecideLanguageTreeEdit, LanguageRpcs } from "./rpc.ts";
import { languageRpcAllowed } from "./capabilities.ts";

test("dedicated raw decision boundary allows rejection/null and rejects acceptance/null or mismatched receipt", () => {
  expect(
    decoded(LanguageTreeEditDecision, {
      acceptance: { ...acceptance, decision: "reject" },
      drafts: null,
    })
  ).toBe(true);
  expect(decoded(LanguageTreeEditDecision, { acceptance, drafts: null })).toBe(false);
  expect(decoded(LanguageTreeEditDecision, { acceptance, drafts: receipt })).toBe(true);
  expect(
    decoded(LanguageTreeEditDecision, { acceptance, drafts: { ...receipt, resourceSnapshots: [] } })
  ).toBe(false);
  expect(
    decoded(LanguageTreeEditDecision, { acceptance, drafts: { ...receipt, durable: false } })
  ).toBe(false);
});

test("dedicated RPC schema retains nested tree ownership before codec and rejects unknown versions", () => {
  const decision = { acceptance, drafts: receipt };

  const encoded = Schema.encodeSync(DecideLanguageTreeEdit.payloadSchema)(
    Schema.decodeUnknownSync(DecideLanguageTreeEdit.payloadSchema)(decision)
  );

  const roundtrip = Schema.decodeUnknownSync(DecideLanguageTreeEdit.payloadSchema)(encoded);

  expect(roundtrip).toEqual(
    Schema.decodeUnknownSync(DecideLanguageTreeEdit.payloadSchema)(decision)
  );
  expect(roundtrip.acceptance.resourceSnapshots).toEqual(
    Schema.decodeUnknownSync(Schema.Array(LanguageResourceSnapshot))(resources)
  );

  for (const format of [undefined, 1, 3])
    expect(() =>
      Schema.decodeUnknownSync(DecideLanguageTreeEdit.payloadSchema)({
        ...decision,
        acceptance: { ...acceptance, format },
      })
    ).toThrow();

  expect(LanguageRpcs.requests.has("languages.tree.edit.decide")).toBe(true);
  expect(languageRpcAllowed("languages.tree.edit.decide", ["languages", "languages.edits"])).toBe(
    false
  );
  expect(
    languageRpcAllowed("languages.tree.edit.decide", ["languages", "languages.resources"])
  ).toBe(false);
  expect(
    languageRpcAllowed("languages.tree.edit.decide", [
      "languages",
      "languages.edits",
      "languages.resources",
      "languages.resources.tree-v2",
    ])
  ).toBe(true);
});

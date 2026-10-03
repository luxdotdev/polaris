import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import {
  BufferAcknowledgments,
  type BufferAcknowledgmentAuthority,
} from "./bufferAcknowledgments.ts";
import { Documents } from "./documents.ts";

const context = P.LanguageContextIdentity.make({
  hostId: P.HostId.make("host"),
  clientId: "client",
  contextId: "context",
  checkout: P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("workspace"),
    path: "/private/tmp/project",
  }),
  projectRoot: "/private/tmp/project",
  providerId: "fake",
  configurationFingerprint: "a".repeat(64),
  generation: 1,
});

const uri = "file:///private/tmp/project/file.ts";

const text = "private unsaved text";

const fixture = (limits?: { entries: number; bytes: number }) => {
  const documents = new Documents(context);
  const controller = new AbortController();
  const principal = {};

  let authority: BufferAcknowledgmentAuthority | null = {
    principal,
    context,
    documents,
    signal: controller.signal,
  };

  const store = new BufferAcknowledgments(() => authority, limits);

  const open = (target = uri, value = text) =>
    documents.apply(
      documents.sequence + 1,
      P.LanguageDocumentNotification.cases.Open.make({
        uri: target,
        languageId: "typescript",
        version: 1,
        text: value,
      }),
      "utf-16"
    );

  const fence = (target = uri, version = 1) =>
    P.LanguageRequestFence.make({
      context: documents.context,
      requiredSequence: documents.sequence,
      documents: [{ uri: target, version }],
    });

  const buffer = { uri, version: 1, text, draftRevision: 27 };

  return {
    store,
    documents,
    controller,
    open,
    fence,
    buffer,
    authority: () => authority,
    replace: (next: BufferAcknowledgmentAuthority | null) => {
      authority = next;
    },
  };
};

const refused = (operation: () => void) => {
  try {
    operation();
    throw new Error("Expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(P.LanguageError);
    expect(String(error)).not.toContain(text);
    expect(String(error)).toContain("Authenticated buffer acknowledgment unavailable");
  }
};

test("exact mirror and independent draft revision required; read is immutable", () => {
  const f = fixture();
  refused(() => f.store.record(f.fence(), f.buffer));
  f.open();
  refused(() => f.store.read(f.fence(), uri));
  refused(() => f.store.record(f.fence(), { ...f.buffer, version: 2 }));
  refused(() => f.store.record(f.fence(), { ...f.buffer, text: "wrong" }));
  f.store.record(f.fence(), f.buffer);
  const value = f.store.read(f.fence(), uri);
  expect(value).toEqual(f.buffer);
  expect(Object.isFrozen(value)).toBe(true);
  refused(() => f.store.record(f.fence(), { ...f.buffer, draftRevision: 26 }));
  expect(f.store.read(f.fence(), uri).draftRevision).toBe(27);
  f.store.dispose();
});

test("foreign owner, checkout, provider, fingerprint and generation cannot record or read", () => {
  const f = fixture();
  f.open();
  f.store.record(f.fence(), f.buffer);

  const foreign = [
    { hostId: P.HostId.make("other") },
    { clientId: "other" },
    { contextId: "other" },
    { providerId: "other" },
    { configurationFingerprint: "b".repeat(64) },
    { generation: 2 },
    { projectRoot: "/private/tmp/other" },
    {
      checkout: P.LanguageCheckout.cases.Workspace.make({
        workspaceId: P.WorkspaceId.make("other"),
        path: context.checkout.path,
      }),
    },
  ];

  for (const change of foreign) {
    const fence = P.LanguageRequestFence.make({
      ...f.fence(),
      context: P.LanguageContextIdentity.make({ ...context, ...change }),
    });

    refused(() => f.store.record(fence, f.buffer));
    refused(() => f.store.read(fence, uri));
  }

  expect(f.store.read(f.fence(), uri)).toEqual(f.buffer);
  f.store.dispose();
});

test("mirror change and close/reopen ABA require new acknowledgment", () => {
  const f = fixture();
  f.open();
  f.store.record(f.fence(), f.buffer);
  f.documents.apply(
    2,
    P.LanguageDocumentNotification.cases.Change.make({
      uri,
      previousVersion: 1,
      version: 2,
      changes: [{ text: "new" }],
    }),
    "utf-16"
  );
  refused(() => f.store.read(f.fence(uri, 2), uri));
  const next = { ...f.buffer, version: 2, text: "new", draftRevision: 40 };
  f.store.record(f.fence(uri, 2), next);
  expect(f.store.read(f.fence(uri, 2), uri)).toEqual(next);
  f.documents.apply(
    3,
    P.LanguageDocumentNotification.cases.Close.make({ uri, version: 2 }),
    "utf-16"
  );
  f.open();
  refused(() => f.store.read(f.fence(), uri));
  f.store.record(f.fence(), f.buffer);
  f.store.close(uri);
  refused(() => f.store.read(f.fence(), uri));
  f.store.dispose();
});

test("abort and independent authority replacement permanently retire the old store", () => {
  for (const kind of ["abort", "missing", "principal", "context", "mirror", "signal"]) {
    const f = fixture();
    f.open();
    f.store.record(f.fence(), f.buffer);
    const original = f.authority();

    if (original === null) throw new Error("Missing fixture authority");

    if (kind === "abort") f.controller.abort();

    if (kind === "missing") f.replace(null);

    if (kind === "principal") f.replace({ ...original, principal: {} });

    if (kind === "context")
      f.replace({
        ...original,
        context: P.LanguageContextIdentity.make({ ...context, generation: 2 }),
      });

    if (kind === "mirror") f.replace({ ...original, documents: new Documents(context) });

    if (kind === "signal") f.replace({ ...original, signal: new AbortController().signal });
    refused(() => f.store.read(f.fence(), uri));
    f.replace(original);
    refused(() => f.store.record(f.fence(), f.buffer));
  }
});

test("entry/byte budgets refuse growth and close releases reserved bytes", () => {
  const f = fixture({ entries: 1, bytes: 100 });
  f.open();
  f.store.record(f.fence(), f.buffer);
  const other = "file:///private/tmp/project/other.ts";
  f.open(other);
  refused(() => f.store.record(f.fence(other), { ...f.buffer, uri: other }));
  expect(f.store.read(f.fence(), uri)).toEqual(f.buffer);
  f.store.close(uri);
  f.store.record(f.fence(other), { ...f.buffer, uri: other });
  expect(f.store.read(f.fence(other), other).uri).toBe(other);
  f.store.dispose();
  const small = fixture({ entries: 1, bytes: 1 });
  small.open();
  refused(() => small.store.record(small.fence(), small.buffer));
  small.store.dispose();
});

test("absent requested document fence, future sequence and malformed fields fail safely", () => {
  const f = fixture();
  f.open();
  f.store.record(f.fence(), f.buffer);
  refused(() => f.store.read({ ...f.fence(), documents: [] }, uri));
  refused(() => f.store.read({ ...f.fence(), requiredSequence: 99 }, uri));
  refused(() => f.store.record(f.fence(), { ...f.buffer, draftRevision: -1 }));
  refused(() => f.store.read(f.fence(), "credential://private"));
  expect(f.store.read(f.fence(), uri)).toEqual(f.buffer);
  f.store.dispose();
});

test("authority exceptions fail safely and cannot recover a retired store", () => {
  const f = fixture();
  f.open();
  const authority = f.authority();
  let failing = false;

  const store = new BufferAcknowledgments(() => {
    if (failing) throw new Error(text);

    return authority;
  });

  store.record(f.fence(), f.buffer);
  failing = true;
  refused(() => store.read(f.fence(), uri));
  failing = false;
  refused(() => store.record(f.fence(), f.buffer));
  refused(
    () =>
      new BufferAcknowledgments(() => {
        throw new Error(text);
      })
  );
  f.store.dispose();
});

test("a saved unchanged mirror remains acknowledged; closed and empty stores refuse", () => {
  const f = fixture();
  f.open();
  f.store.record(f.fence(), f.buffer);
  f.documents.apply(
    2,
    P.LanguageDocumentNotification.cases.Save.make({
      uri,
      version: 1,
      diskVersion: new P.FileVersion({ mtimeMs: 1, size: 0, hash: "fake" }),
    }),
    "utf-16"
  );
  expect(f.store.read(f.fence(), uri)).toEqual(f.buffer);
  f.documents.apply(
    3,
    P.LanguageDocumentNotification.cases.Close.make({ uri, version: 1 }),
    "utf-16"
  );
  refused(() => f.store.read(f.fence(), uri));
  f.store.close(uri);
  f.store.dispose();
  refused(() => new BufferAcknowledgments(() => null));
});

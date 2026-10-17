import { expect, test } from "bun:test";
import {
  HostId,
  LanguageCheckout,
  LanguageContextIdentity,
  LanguageDocumentNotification,
  WorkspaceId,
} from "@polaris/protocol";
import { Documents, positionOffset } from "./documents.ts";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** A drive-rooted path on Windows, where a file URI needs one; as written on POSIX. */
const project = resolve("/private/tmp/project");

const context = LanguageContextIdentity.make({
  hostId: HostId.make("host"),
  clientId: "client",
  contextId: "context",
  checkout: LanguageCheckout.cases.Workspace.make({
    workspaceId: WorkspaceId.make("workspace"),
    path: project,
  }),
  projectRoot: project,
  providerId: "fake",
  configurationFingerprint: "a".repeat(64),
  generation: 1,
});

const uri = pathToFileURL(join(project, "file.ts")).href;

test("Unicode scalar boundaries and CRLF positions use negotiated encoding", () => {
  const text = "a😀é\r\nz";
  expect(positionOffset(text, { line: 0, character: 3 }, "utf-16")).toBe(3);
  expect(positionOffset(text, { line: 0, character: 5 }, "utf-8")).toBe(3);
  expect(positionOffset(text, { line: 0, character: 2 }, "utf-32")).toBe(3);
  expect(positionOffset(text, { line: 1, character: 1 }, "utf-16")).toBe(7);
  expect(() => positionOffset(text, { line: 0, character: 2 }, "utf-16")).toThrow();
  expect(() => positionOffset(text, { line: 0, character: 2 }, "utf-8")).toThrow();
  expect(() => positionOffset(text, { line: 2, character: 0 }, "utf-16")).toThrow();
});

test("incremental changes, duplicate/gap/previous versions and invalid URI do not advance ack", () => {
  const docs = new Documents(context);
  docs.apply(
    1,
    LanguageDocumentNotification.cases.Open.make({
      uri,
      languageId: "typescript",
      version: 1,
      text: "a😀é",
    }),
    "utf-16"
  );
  docs.apply(
    2,
    LanguageDocumentNotification.cases.Change.make({
      uri,
      previousVersion: 1,
      version: 2,
      changes: [
        {
          range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
          rangeLength: 2,
          text: "b",
        },
      ],
    }),
    "utf-16"
  );
  expect(docs.open.get(uri)?.text).toBe("abé");

  for (const seq of [2, 4])
    expect(() =>
      docs.apply(seq, LanguageDocumentNotification.cases.Close.make({ uri, version: 2 }), "utf-16")
    ).toThrow();
  expect(() =>
    docs.apply(
      3,
      LanguageDocumentNotification.cases.Change.make({
        uri,
        previousVersion: 1,
        version: 3,
        changes: [{ text: "bad" }],
      }),
      "utf-16"
    )
  ).toThrow();
  expect(() =>
    docs.apply(
      3,
      LanguageDocumentNotification.cases.Open.make({
        uri: pathToFileURL(resolve("/private/tmp/sibling/file.ts")).href,
        languageId: "typescript",
        version: 1,
        text: "bad",
      }),
      "utf-16"
    )
  ).toThrow();
  expect(docs.sequence).toBe(2);
  expect(docs.open.get(uri)?.text).toBe("abé");
  expect(() =>
    docs.apply(
      3,
      LanguageDocumentNotification.cases.Change.make({
        uri,
        previousVersion: 2,
        version: 3,
        changes: [{ text: "é".repeat(700000) }],
      }),
      "utf-16"
    )
  ).toThrow();
  expect(docs.sequence).toBe(2);
});

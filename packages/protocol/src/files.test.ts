import { expect, test } from "bun:test";
import { Schema } from "effect";
import { ChangedOnDisk, FileContent, WriteFile } from "./files.ts";
import { DaemonRpcs, ReadFile } from "./rpc.ts";

test("Editor contracts are additive: a conflict may have no current version", () => {
  const codec = Schema.toCodecJson(ChangedOnDisk);
  expect(
    Schema.decodeUnknownSync(codec)(
      JSON.parse('{"_tag":"ChangedOnDisk","path":"/a","current":null}')
    ).current
  ).toBeNull();
  expect(DaemonRpcs.requests.has("files.write")).toBe(true);
  expect(DaemonRpcs.requests.has("files.watchFile")).toBe(true);
  expect(
    Schema.decodeUnknownSync(ReadFile.payloadSchema)({ path: "/a", offset: null, length: null })
  ).toEqual({ path: "/a", offset: null, length: null });
  expect(() =>
    Schema.decodeUnknownSync(WriteFile.payloadSchema)({
      path: "/a",
      content: FileContent.cases.Inline.make({ text: "" }),
    })
  ).toThrow();
});

import { expect, test } from "bun:test";
import { Schema } from "effect";
import { CapabilityList } from "./capabilities.ts";
import { ChangedOnDisk, FileContent, FileVersion, WriteFile } from "./files.ts";
import { DaemonRpcs, ReadFile } from "./rpc.ts";

test("Editor contracts are additive and version conflicts cross JSON", () => {
  const version = new FileVersion({ mtimeMs: 1.25, size: 4, hash: "abcd" });
  const codec = Schema.toCodecJson(ChangedOnDisk);
  const conflict = new ChangedOnDisk({ path: "/a", current: version });
  expect(Schema.decodeUnknownSync(codec)(Schema.encodeSync(codec)(conflict))).toEqual(conflict);
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
  expect(Schema.decodeUnknownSync(CapabilityList)(["files.read", "files.write", "future"])).toEqual(
    ["files.read", "files.write"]
  );
});

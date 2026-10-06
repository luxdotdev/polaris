import { expect, test } from "bun:test";
import { Schema } from "effect";
import { deferredSchema } from "./deferred.ts";

test("embedding a language union defers guards and shares one schema across factories and decoding", () => {
  let builds = 0;

  const value = deferredSchema(() => {
    builds++;

    return Schema.TaggedUnion({ Ready: { version: Schema.Int }, Missing: {} });
  });

  const outer = Schema.Struct({ value });
  expect(builds).toBe(0);
  const ready = value.cases.Ready.make({ version: 1 });
  expect(Schema.decodeUnknownSync(outer)({ value: ready })).toEqual({ value: ready });
  expect(value.guards.Ready(ready)).toBe(true);
  expect(builds).toBe(1);
  expect(() =>
    Schema.decodeUnknownSync(Schema.fromJsonString(outer))(
      '{"value":{"_tag":"Ready","version":"wrong"}}'
    )
  ).toThrow();
});

test("checks added after deferral retain validation", () => {
  const value = deferredSchema(() => Schema.TaggedUnion({ Ready: { version: Schema.Int } }));
  const checked = value.check(Schema.makeFilter((input) => input.version > 0));
  expect(Schema.decodeUnknownSync(checked)(value.cases.Ready.make({ version: 1 })).version).toBe(1);
  expect(() => Schema.decodeUnknownSync(checked)(value.cases.Ready.make({ version: 0 }))).toThrow();
});

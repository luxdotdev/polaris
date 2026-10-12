import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { contextIdOf } from "./groups.ts";

describe("contextIdOf", () => {
  const key = JSON.stringify(["local", { clientId: "language-a" }, "/repo", "typescript"]);

  test("a group keeps its context id across page loads, so a reload finds the Daemon's context", () => {
    expect(contextIdOf(key)).toBe(contextIdOf(key.split("").join("")));
  });

  test("different groups get different ids", () => {
    expect(contextIdOf(key)).not.toBe(contextIdOf(key.replace("/repo", "/repo/app")));
  });

  test("the id is a valid language key", () => {
    expect(Schema.is(P.LanguageKey)(contextIdOf(key))).toBe(true);
  });
});

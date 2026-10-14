import { describe, expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { contextIdOf } from "./groups.ts";

describe("contextIdOf", () => {
  const key = JSON.stringify(["local", { clientId: "language-a" }, "/repo", "typescript"]);

  test("a group keeps its context id across page loads, so a reload finds the Daemon's context", async () => {
    // A fresh module instance stands in for the reloaded page.
    // SAFETY: the query only makes a new instance of this same module.
    const reloaded = (await import(
      `./groups.ts?reload=${Date.now()}`
    )) as typeof import("./groups.ts");

    expect(reloaded.contextIdOf).not.toBe(contextIdOf);
    expect(reloaded.contextIdOf(key)).toBe(contextIdOf(key));
  });

  test("different groups get different ids", () => {
    expect(contextIdOf(key)).not.toBe(contextIdOf(key.replace("/repo", "/repo/app")));
  });

  test("the id is a valid language key", () => {
    expect(Schema.is(P.LanguageKey)(contextIdOf(key))).toBe(true);
  });
});

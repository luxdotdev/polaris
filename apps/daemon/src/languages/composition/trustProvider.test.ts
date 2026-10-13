import { expect, test } from "bun:test";
import { trustLanguage, trustProvider } from "./trustProvider.ts";

test("Trust inspects a Rust or Lua file through its own server's discovery", () => {
  expect(["a.rs", "a.lua", "a.svelte", "a.prisma", "a.ts"].map(trustProvider)).toEqual([
    "rust-analyzer",
    "lua-language-server",
    "svelte-language-server",
    "prisma-language-server",
    "typescript-language-server",
  ]);
  expect(["a.rs", "a.lua", "a.svelte"].map(trustLanguage)).toEqual(["rust", "lua", "typescript"]);
});

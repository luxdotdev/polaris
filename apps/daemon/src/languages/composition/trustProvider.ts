import { extname } from "node:path";
import type { LanguageSyntaxId } from "@polaris/protocol";

/** The provider whose discovery says what Trust would run for a file, and its language. */
const BY_EXTENSION = new Map<string, readonly [string, LanguageSyntaxId]>([
  [".svelte", ["svelte-language-server", "typescript"]],
  [".prisma", ["prisma-language-server", "typescript"]],
  [".rs", ["rust-analyzer", "rust"]],
  [".lua", ["lua-language-server", "lua"]],
]);

const typescript = ["typescript-language-server", "typescript"] as const;

export const trustProvider = (path: string) => (BY_EXTENSION.get(extname(path)) ?? typescript)[0];

export const trustLanguage = (path: string) => (BY_EXTENSION.get(extname(path)) ?? typescript)[1];

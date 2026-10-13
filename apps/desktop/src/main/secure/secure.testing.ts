/** Test helpers: a sealer that needs no keychain, and a store on a throwaway directory. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Backend, Sealer } from "./index.ts";

const PREFIX = "sealed:";

/** Seals with base64 behind a prefix: enough to prove nothing is written in the clear. */
export const testSealer = (backend: Backend = "ok"): Sealer => ({
  backend: () => Promise.resolve(backend),
  seal: (plain) =>
    Promise.resolve(new TextEncoder().encode(`${PREFIX}${Buffer.from(plain).toString("base64")}`)),
  open: (sealed) => {
    const text = new TextDecoder().decode(sealed);

    if (!text.startsWith(PREFIX)) return Promise.reject(new Error("not sealed for this user"));

    return Promise.resolve({
      text: Buffer.from(text.slice(PREFIX.length), "base64").toString("utf8"),
      shouldReEncrypt: false,
    });
  },
});

/** What `testSealer` writes for `plain`, for records placed on disk by hand. */
export const testSealed = (plain: string) =>
  new TextEncoder().encode(`${PREFIX}${Buffer.from(plain).toString("base64")}`);

/** A throwaway userData directory, removed after `run`. */
export const withUserData = async <A>(run: (userData: string) => Promise<A>) => {
  const userData = mkdtempSync(join(tmpdir(), "polaris-secure-"));

  try {
    return await run(userData);
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
};

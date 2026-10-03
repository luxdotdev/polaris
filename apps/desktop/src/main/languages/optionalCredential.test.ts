import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { optionalLanguageCredential } from "./optionalCredential.ts";

const withRoot = (run: (root: string) => void) => {
  const root = mkdtempSync("/tmp/pl-j1-optional-proof-");

  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

test("valid private proof adds identity without warnings", () =>
  withRoot((root) => {
    const warnings: string[] = [];

    const options = optionalLanguageCredential(join(root, "private"), (message) =>
      warnings.push(message)
    );

    expect(options.clientIdentity).toBeDefined();
    expect(warnings).toEqual([]);
  }));

test("corrupt private proof preserves ordinary options and refuses silent regeneration or diagnostics", () =>
  withRoot((root) => {
    const privatePath = join(root, "private");
    optionalLanguageCredential(privatePath, () => {});
    const file = join(privatePath, "language-client-proof-v1");
    const corrupt = "secret-invalid-proof\n";
    writeFileSync(file, corrupt);
    chmodSync(file, 0o600);
    const warnings: string[] = [];

    const options = {
      ordinaryClient: true,
      ...optionalLanguageCredential(privatePath, (message) => warnings.push(message)),
    };

    expect(options.ordinaryClient).toBe(true);
    expect(Object.hasOwn(options, "clientIdentity")).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(corrupt);
    expect(warnings).toEqual([
      "Language identity unavailable: private credential could not be loaded",
    ]);
    expect(warnings.join(" ")).not.toContain(corrupt.trim());
  }));

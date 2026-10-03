import { afterAll, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { Effect } from "effect";

export const removeTempDirectory = (directory: string): void => {
  rmSync(directory, { recursive: true, force: true });
};

export const tempDirectory = (prefix: string): string => {
  const directory = mkdtempSync(prefix);
  // Register in the calling test's context; module-level hooks only cover the importing file.
  afterEach(() => removeTempDirectory(directory));

  return directory;
};

/** Declare before beforeAll; the returned factory keeps shared roots until the suite ends. */
export const suiteTempDirectory = (prefix: string): (() => string) => {
  const directories: Array<string> = [];
  afterAll(() => {
    for (const directory of directories.splice(0)) removeTempDirectory(directory);
  });

  return () => {
    const directory = mkdtempSync(prefix);
    directories.push(directory);

    return directory;
  };
};

export const scopedTempDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.sync(() => tempDirectory(prefix)),
    (directory) => Effect.sync(() => removeTempDirectory(directory))
  );

import { randomBytes } from "node:crypto";
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Redacted } from "effect";

export class LanguageCredentialError extends Error {
  constructor() {
    super("Language credential unavailable");
  }
}

const safeDirectory = (directory: string) => {
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const stat = lstatSync(directory);

  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o777) !== 0o700 ||
    stat.uid !== process.getuid?.()
  )
    throw new LanguageCredentialError();
};

const readProof = (path: string): Redacted.Redacted<string> => {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);

  try {
    const stat = fstatSync(fd);

    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.uid !== process.getuid?.() ||
      stat.size !== 65
    )
      throw new LanguageCredentialError();
    const value = readFileSync(fd, "utf8");

    if (!/^[a-f0-9]{64}\n$/.test(value)) throw new LanguageCredentialError();

    return Redacted.make(value.slice(0, 64), { label: "language identity" });
  } finally {
    closeSync(fd);
  }
};

/** Explicit private Main directory only; never discovers userData or repairs unsafe records. */
export const loadLanguageCredential = (directory: string): Redacted.Redacted<string> => {
  const path = join(directory, "language-client-proof-v1");
  let partial: string | null = null;

  try {
    safeDirectory(directory);

    try {
      lstatSync(path);

      return readProof(path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }

    partial = join(directory, `.proof-${randomBytes(16).toString("hex")}.part`);

    const fd = openSync(
      partial,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );

    try {
      writeFileSync(fd, `${randomBytes(32).toString("hex")}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    try {
      linkSync(partial, path);
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    }

    unlinkSync(partial);
    partial = null;

    const dir = openSync(
      directory,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    );

    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }

    return readProof(path);
  } catch {
    throw new LanguageCredentialError();
  } finally {
    if (partial !== null) {
      try {
        unlinkSync(partial);
      } catch {
        /* An owned incomplete sibling may survive an OS failure. */
      }
    }
  }
};

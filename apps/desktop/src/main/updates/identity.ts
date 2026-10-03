import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { Option, Schema } from "effect";

const InstallId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
);

/** A random local identity, never derived from an account, Host or Workspace. */
export const installId = (userData: string): string => {
  const path = join(userData, "install-id");

  try {
    const previous = Schema.decodeUnknownOption(InstallId)(readFileSync(path, "utf8").trim());

    if (Option.isSome(previous)) return previous.value;
  } catch {
    // The first launch has no identity file.
  }

  const id = randomUUID();
  mkdirSync(userData, { recursive: true });
  writeFileSync(path, `${id}\n`, { mode: 0o600 });

  return id;
};

/** Downloads, disk images and Gatekeeper's translocated copies cannot replace themselves. */
export const cannotInstallHere = (appPath: string, downloads: string): boolean => {
  const path = resolve(appPath);

  return (
    path === resolve(downloads) ||
    path.startsWith(`${resolve(downloads)}${sep}`) ||
    path.startsWith("/Volumes/") ||
    path.includes("/AppTranslocation/")
  );
};

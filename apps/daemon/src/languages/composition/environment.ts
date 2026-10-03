import { existsSync } from "node:fs";
import { Context, Schema } from "effect";
import { LanguagePlatform, type HostId } from "@polaris/protocol";

/** Transport supplies the actual Daemon Host; this is configuration, never request authentication. */
export class HostLanguageEnvironment extends Context.Service<
  HostLanguageEnvironment,
  { hostId: HostId; root: string; platform: typeof LanguagePlatform.Type | null }
>()("polaris/languages/HostLanguageEnvironment") {}

/** Unknown Linux runtime families remain unavailable instead of selecting a guessed artifact. */
export const currentLanguagePlatform = (): typeof LanguagePlatform.Type | null => {
  const arch = process.arch;

  const os = process.platform;

  if (arch !== "arm64" && arch !== "x64") return null;

  if (os === "darwin")
    return Schema.decodeUnknownSync(LanguagePlatform)({ os, arch, libc: "none" });

  if (os !== "linux") return null;

  const glibc =
    arch === "x64"
      ? ["/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2"]
      : ["/lib/ld-linux-aarch64.so.1", "/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1"];

  const musl = arch === "x64" ? "/lib/ld-musl-x86_64.so.1" : "/lib/ld-musl-aarch64.so.1";

  const libc = glibc.some((path) => existsSync(path)) ? "glibc" : existsSync(musl) ? "musl" : null;

  return libc === null ? null : Schema.decodeUnknownSync(LanguagePlatform)({ os, arch, libc });
};

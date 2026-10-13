/**
 * `HostPlatform`: what this Host is (os, arch, libc), detected once. Every
 * Daemon module that names the platform, the build id or the libc to `dlopen`
 * reads it from here. See `detect.ts` for the rule and ADR 0045.
 */
import { existsSync } from "node:fs";
import { type LanguagePlatform } from "@polaris/protocol";
import { Context, Layer } from "effect";
import { detectPlatform, libcPathOf, type PlatformFacts, runtimePlatformOf } from "./detect.ts";

export {
  detectPlatform,
  GLIBC_LOADERS,
  type Libc,
  libcPathOf,
  muslLoader,
  type PlatformFacts,
  type PlatformProbe,
  runtimePlatformOf,
} from "./detect.ts";

let detected: PlatformFacts | undefined;

/** This process's platform. `process.env.POLARIS_LIBC` is replaced by a constant in compiled builds. */
export const hostPlatform = (): PlatformFacts => {
  detected ??= detectPlatform({
    os: process.platform,
    arch: process.arch,
    compiledLibc: process.env.POLARIS_LIBC,
    exists: existsSync,
  });

  return detected;
};

export const isMusl = (): boolean => hostPlatform().libc === "musl";

/** `<os>-<arch>`, plus `-musl` on a musl Linux. */
export const runtimePlatform = (): string => runtimePlatformOf(hostPlatform());

export const libcPath = (): string => libcPathOf(hostPlatform());

/** The language catalog's platform; null where no artifact can be chosen (another arch, an unknown libc). */
export const languagePlatformOf = (facts: PlatformFacts): typeof LanguagePlatform.Type | null => {
  const { os, arch, libc } = facts;

  if (arch !== "arm64" && arch !== "x64") return null;

  if (os === "darwin") return { os, arch, libc: "none" };

  if (os === "linux" && (libc === "glibc" || libc === "musl")) return { os, arch, libc };

  return null;
};

/** What `hello` says beside `HostInfo.platform`: the libc on Linux, nothing elsewhere. */
export const wireLibcOf = (facts: PlatformFacts): "glibc" | "musl" | undefined =>
  facts.libc === "glibc" || facts.libc === "musl" ? facts.libc : undefined;

/** Effect code reads the platform here; tests provide another with `HostPlatform.test`. */
export class HostPlatform extends Context.Reference<PlatformFacts>("polaris/daemon/HostPlatform", {
  defaultValue: hostPlatform,
}) {
  static readonly live = Layer.sync(HostPlatform, hostPlatform);

  static readonly test = (fixed: Partial<PlatformFacts>) =>
    Layer.succeed(HostPlatform, { os: "linux", arch: "x64", libc: "glibc", ...fixed });
}

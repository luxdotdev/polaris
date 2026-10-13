import type { Requirement } from "../catalog/model.ts";
import type { ProbeFact } from "../catalog/selection.ts";
import { findRustToolchain, type RustToolchainOptions } from "./toolchain.ts";

export const rustToolchainIds = ["cargo", "rust-src", "rustfmt"];

/** Reads the Host's toolchain afresh on each call, so Check again sees a new install. */
export async function rustToolchainProbes(
  requirements: readonly Requirement[],
  options?: RustToolchainOptions
): Promise<ProbeFact[]> {
  const wanted = requirements.filter((requirement) => rustToolchainIds.includes(requirement.id));

  if (wanted.length === 0) return [];
  const toolchain = await findRustToolchain(options);

  const paths = new Map([
    ["cargo", toolchain?.cargo ?? null],
    ["rust-src", toolchain?.rustSrc ?? null],
    ["rustfmt", toolchain?.rustfmt ?? null],
  ]);

  return wanted.map(({ id }) => {
    const executable = paths.get(id) ?? null;

    return { id, executable, version: executable === null ? null : "present" };
  });
}

import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { DiscoveryFacts } from "../discovery/index.ts";
import type { InstalledVersion } from "../install/types.ts";
import type { VerifiedLaunchPlan } from "../availability/launch.ts";
import { failure } from "../install/validation.ts";
import { rustAnalyzerOptions, type SettingsFacts } from "./settings.ts";
import type { RustCrate } from "./project.ts";
import { findRustToolchain, type RustToolchain } from "./toolchain.ts";

/** A rust-project.json kept outside the Workspace, so no rust-analyzer.toml there applies. */
async function writeProject(toolRoot: string, facts: RustFacts, toolchain: RustToolchain) {
  const directory = join(
    toolRoot,
    "projects",
    createHash("sha256").update(facts.projectRoot).digest("hex").slice(0, 32)
  );

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, "rust-project.json");
  const temporary = `${path}.${crypto.randomUUID()}`;

  const project = new Map<string, string | readonly RustCrate[]>([["sysroot", toolchain.sysroot]]);

  if (toolchain.rustSrc !== null) project.set("sysroot_src", toolchain.rustSrc);
  project.set("crates", facts.rustCrates ?? []);

  await writeFile(temporary, JSON.stringify(Object.fromEntries(project)), { mode: 0o600 });
  await rename(temporary, path);

  return path;
}

/** After Trust rustup's proxies apply the project's toolchain; they may live outside the PATH. */
const trustedPath = () =>
  [
    process.env.PATH ?? "",
    join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin"),
    "/opt/homebrew/opt/rustup/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]
    .filter((part) => part !== "")
    .join(":");

/**
 * Before Trust the toolchain's binaries are named outright (CARGO, RUSTC, RUSTFMT), so no rustup
 * proxy reads the Workspace's rust-toolchain.toml and no cargo runs in it.
 */
export type RustFacts = SettingsFacts & Pick<DiscoveryFacts, "projectRoot" | "rustCrates">;

export async function rustLaunch(
  facts: RustFacts,
  installed: Pick<InstalledVersion, "identity" | "directory">,
  find: () => Promise<RustToolchain | null> = findRustToolchain
): Promise<VerifiedLaunchPlan> {
  const found = await find();

  if (found === null)
    throw failure("missing-prerequisite", "The Rust toolchain (cargo and rustc) is missing");
  const entry = join(installed.directory, "rust-analyzer");

  if (facts.workspaceTrusted)
    return {
      identity: installed.identity,
      entry,
      launch: {
        executable: entry,
        args: [],
        cwd: facts.projectRoot,
        environment: { PATH: trustedPath() },
        initializationOptions: rustAnalyzerOptions(facts, null),
      },
    };

  const project = await writeProject(dirname(dirname(installed.directory)), facts, found);

  return {
    identity: installed.identity,
    entry,
    launch: {
      executable: entry,
      args: [],
      cwd: facts.projectRoot,
      environment: {
        PATH: join(found.sysroot, "bin"),
        CARGO: found.cargo,
        RUSTC: found.rustc,
        RUSTFMT: found.rustfmt ?? join(found.sysroot, "bin/rustfmt"),
        RUSTUP_TOOLCHAIN: found.sysroot,
        RUSTC_WRAPPER: "",
        RUSTC_WORKSPACE_WRAPPER: "",
      },
      initializationOptions: rustAnalyzerOptions(facts, project),
    },
  };
}

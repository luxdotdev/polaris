/**
 * The Reviewer's Codex thread runs under a permission profile that reads only its checkout
 * (plus what a shell needs), never the legacy `read-only` sandbox, which reads the whole disk.
 * See docs/adr/0054-the-reviewer-reads-only-its-checkout.md.
 */
import { Effect } from "effect";
import { CONFINED_GIT_ENV, type ReadConfinement, readConfinement } from "../confinement.ts";
import type * as Gen from "./generated/index.ts";
import { codexError } from "./RpcConnection.ts";

export const REVIEWER_PROFILE = "polaris_reviewer";

/** Verified on codex-cli 0.162.1; the bindings Polaris is generated from (0.159.2) carry profiles. */
export const PROFILE_MIN_VERSION = "0.159.2";

/** `thread/start`'s `config` for a read-only thread: the profile, chosen by default. */
export const reviewerConfig = (confinement: ReadConfinement) => ({
  default_permissions: REVIEWER_PROFILE,
  permissions: {
    [REVIEWER_PROFILE]: {
      filesystem: {
        ":minimal": "read",
        // `:minimal` alone lets a command read and write every /tmp.
        ":slash_tmp": "deny",
        ":tmpdir": "deny",
        ...Object.fromEntries(
          [confinement.root, ...confinement.shellRoots].map((path) => [path, "read"])
        ),
      },
    },
  },
  "shell_environment_policy.set": CONFINED_GIT_ENV,
});

/** The app-server's version from `initialize`'s `userAgent` ("polaris/0.162.1 (Mac OS …)"). */
export const versionOfUserAgent = (userAgent: string): string | null =>
  userAgent.match(/^[^/\s]+\/(\d+\.\d+\.\d+)/)?.[1] ?? null;

/** Whether this app-server can hold a thread to a permission profile; unknown is no. */
export const confinesReads = (userAgent: string): boolean => {
  const version = versionOfUserAgent(userAgent);

  return version !== null && Bun.semver.order(version, PROFILE_MIN_VERSION) >= 0;
};

/** How a thread is sandboxed: by its permission mode's `sandbox`, or (read-only) by the profile. */
export interface ThreadSandboxing {
  readonly mode: { readonly sandbox?: Gen.SandboxMode };
  readonly config: ReturnType<typeof reviewerConfig> | null;
}

/**
 * A read-only thread gets the profile and no mode (Codex refuses both). An app-server too old
 * for profiles would fall back to the user's own sandbox, so that session doesn't start.
 */
export const threadSandboxing = (options: {
  readonly readOnly: boolean | undefined;
  readonly sandbox: Gen.SandboxMode;
  readonly userAgent: string;
  readonly cwd: string;
}) =>
  Effect.gen(function* () {
    if (options.readOnly !== true)
      return { mode: { sandbox: options.sandbox }, config: null } satisfies ThreadSandboxing;

    if (!confinesReads(options.userAgent))
      return yield* codexError(
        `Codex ${versionOfUserAgent(options.userAgent) ?? "of an unknown version"} can't keep the reviewer to its checkout. Update Codex to ${PROFILE_MIN_VERSION} or later.`
      );
    const confinement = yield* Effect.promise(() => readConfinement(options.cwd));

    return { mode: {}, config: reviewerConfig(confinement) } satisfies ThreadSandboxing;
  });

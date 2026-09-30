/**
 * The Harness catalogue: every Harness Polaris can drive, vetted before it is
 * added (ENG-199). Adding a Harness is one entry here plus its driver in the
 * Daemon; its `harness.<kind>` capability and its kind follow from the entry.
 */
import { Schema } from "effect";

/**
 * A Harness's kind as it travels: open, so an event naming a Harness this
 * build's catalogue doesn't list (from a newer Daemon) still decodes. Look it
 * up with `harnessEntry`; a Client shows an unknown kind by its name alone.
 */
export const HarnessKind = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]*$/));

export type HarnessKind = typeof HarnessKind.Type;

/**
 * How a user sets a Harness up on a Host. Polaris only drives Harnesses the user
 * already has: it never installs one (it links the docs) and never signs in for them (ADR 0001).
 */
export interface HarnessSetup {
  /** One line for a host where the Harness is not installed, pointing at its docs. */
  readonly install: string;
  /** One line for a host where it is installed but not signed in. */
  readonly signIn: string;
  /** The argv that starts its own sign-in, run in a Harness terminal on the Host. */
  readonly signInCommand: ReadonlyArray<string>;
  readonly docsUrl: string;
}

export interface HarnessEntry<K extends string = string> {
  readonly kind: K;
  /** The product name, as the vendor writes it. */
  readonly name: string;
  /** The capability a Daemon announces in `hello` when it has this Harness's driver. */
  readonly capability: `harness.${K}`;
  /** The oldest version its driver supports; older installs report `outdated`. */
  readonly minVersion: string;
  readonly setup: HarnessSetup;
}

const entry = <const K extends string>(
  kind: K,
  details: Omit<HarnessEntry<K>, "kind" | "capability">
): HarnessEntry<K> => ({ kind, capability: `harness.${kind}`, ...details });

export const HARNESS_CATALOGUE = [
  entry("claude", {
    name: "Claude Code",
    // The Claude Code the pinned Agent SDK is built for (`claudeCodeVersion`).
    minVersion: "2.1.283",
    setup: {
      install: "Claude Code isn't installed on this host. See its setup guide.",
      signIn: "Sign in to Claude Code in its own terminal.",
      signInCommand: ["claude", "auth", "login"],
      docsUrl: "https://code.claude.com/docs/en/setup",
    },
  }),
  entry("codex", {
    name: "Codex",
    // The codex-cli the app-server bindings were generated from.
    minVersion: "0.157.1",
    setup: {
      install: "Codex isn't installed on this host. See its setup guide.",
      signIn: "Sign in to Codex in its own terminal.",
      signInCommand: ["codex", "login"],
      docsUrl: "https://developers.openai.com/codex/cli",
    },
  }),
  // Driven through the Agent Client Protocol (ACP v1).
  entry("gemini", {
    name: "Gemini CLI",
    // The first release with `--acp` (before it, only `--experimental-acp`).
    minVersion: "0.33.0",
    setup: {
      install: "Install Gemini CLI on this host.",
      installCommand: "npm install -g @google/gemini-cli",
      signIn: "Sign in to Gemini CLI in its own terminal: run gemini and pick how to sign in.",
      signInCommand: ["gemini"],
      docsUrl: "https://geminicli.com/docs/get-started/",
    },
  }),
  entry("copilot", {
    name: "GitHub Copilot CLI",
    // The first general-availability release; ACP, session load and effort predate it.
    minVersion: "1.0.0",
    setup: {
      install: "Install GitHub Copilot CLI on this host.",
      installCommand: "npm install -g @github/copilot",
      signIn: "Sign in to GitHub Copilot CLI in its own terminal.",
      signInCommand: ["copilot", "login"],
      docsUrl: "https://docs.github.com/en/copilot/how-tos/copilot-cli",
    },
  }),
] as const;

/** The kinds this build's catalogue lists. */
export type KnownHarnessKind = (typeof HARNESS_CATALOGUE)[number]["kind"];

export const KNOWN_HARNESS_KINDS: ReadonlyArray<KnownHarnessKind> = HARNESS_CATALOGUE.map(
  (harness) => harness.kind
);

export const harnessEntry = (kind: HarnessKind): HarnessEntry | undefined =>
  HARNESS_CATALOGUE.find((harness) => harness.kind === kind);

export const isKnownHarness = (kind: HarnessKind): kind is KnownHarnessKind =>
  harnessEntry(kind) !== undefined;

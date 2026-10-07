/**
 * The language status pill and its popover (DESIGN.md, Editor: Language status; Paper L1, L3):
 * one pure reading of what the Daemon reported for the open file.
 */
import type * as P from "@polaris/protocol";
import { Match, Predicate } from "effect";
import type { TrustStatus } from "../trust/model.ts";
import { decisionOf } from "../trust/model.ts";
import type { ContextRuntime, Discovered, FileLanguage, HostTools, Runtime } from "./store.ts";

export type PillKind =
  | "syntax"
  | "setting-up"
  | "ready"
  | "bundled"
  | "prerequisite"
  | "trust"
  | "restarting"
  | "stopped"
  | "crashed"
  | "unavailable";

/** Filled: running as intended. Hollow: limited or not yet running. Failed: a stopped server. */
export type Mark = "filled" | "hollow" | "failed" | "none";

export type ActionId =
  | "restart"
  | "show-log"
  | "settings"
  | "trust"
  | "use-bundled"
  | "use-project"
  | "check-again";

export interface StatusAction {
  readonly id: ActionId;
  readonly label: string;
  readonly hint?: string | undefined;
}

export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly note?: string | undefined;
}

export interface Progress {
  readonly tool: string;
  readonly fraction: number | null;
  readonly amount: string;
}

export interface StatusView {
  readonly kind: PillKind;
  readonly mark: Mark;
  /** The pill: the language, plus a word only when something differs from ready. */
  readonly pill: string;
  readonly title: string;
  readonly why: string;
  readonly tone: "default" | "failed";
  readonly facts: readonly Fact[];
  readonly progress: Progress | null;
  readonly command: string | null;
  readonly commandHost: string | null;
  readonly stderr: string | null;
  readonly actions: readonly StatusAction[];
  /** The provider the actions address, if any. */
  readonly providerId: string | null;
}

export interface StatusInput {
  /** The language's name for this file ("TypeScript", "Python", "Markdown"). */
  readonly language: string;
  readonly file: FileLanguage | null;
  /** The file's providers' runtimes, in discovery order. */
  readonly runtimes: readonly ContextRuntime[];
  readonly trust: TrustStatus | null;
  readonly tools: HostTools | null;
  /** The Host's name as a fact ("Mac Studio") and in running text ("this Mac"). */
  readonly host: string;
  readonly hostInSentence: string;
  readonly workspace: string;
  readonly now: number;
}

const TS = "typescript-language-server";

/** "TypeScript" for the TypeScript server, which also serves JavaScript; else the language. */
const serverName = (input: StatusInput, providerId: string | null) =>
  providerId === TS ? "TypeScript" : input.language;

const base = (input: StatusInput, providerId: string | null) => {
  const name = serverName(input, providerId);

  const facts: readonly Fact[] = [];

  return {
    facts,
    progress: null,
    command: null,
    commandHost: null,
    stderr: null,
    tone: "default" as const,
    providerId,
    restart: { id: "restart" as const, label: `Restart ${name} server` },
    log: { id: "show-log" as const, label: "Show language server log" },
    settings: { id: "settings" as const, label: "Language settings…" },
    name,
  };
};

const pill = (input: StatusInput, word: string | null) =>
  word === null ? input.language : `${input.language} · ${word}`;

export const version = (tools: HostTools | null, toolId: string) => {
  const fact = tools?.availability[toolId];

  if (fact === undefined) return tools?.pinned?.[toolId] ?? null;

  return Predicate.isTagged(fact.installation, "Installed")
    ? fact.installation.version
    : fact.pinnedVersion;
};

const TOOL_WORDS = new Map<string, string>([
  ["node", "its Node"],
  ["typescript", "the bundled TypeScript"],
  [TS, "the language server"],
]);

const listed = (words: readonly string[]) =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

const MB = 1024 * 1024;

const megabytes = (bytes: number) => `${Math.max(1, Math.round(bytes / MB))} MB`;

export const progressOf = (tools: HostTools | null): Progress | null => {
  const active = Object.values(tools?.progress ?? {}).find(
    (value) => !["completed", "failed", "cancelled"].includes(value.phase)
  );

  if (active === undefined) return null;
  const total = active.totalBytes;

  return {
    tool: `${active.toolId} ${active.version}`,
    fraction: total === null || total === 0 ? null : Math.min(1, active.downloadedBytes / total),
    amount:
      total === null
        ? megabytes(active.downloadedBytes)
        : `${Math.round(active.downloadedBytes / MB)} of ${megabytes(total)}`,
  };
};

const installing = (tools: HostTools | null) =>
  Object.values(tools?.availability ?? {})
    .filter((fact) => Predicate.isTagged(fact.installation, "Installing"))
    .map((fact) => fact.toolId);

const settingUp = (
  input: StatusInput,
  providerId: string | null,
  stage: "checking" | "starting"
): StatusView => {
  const b = base(input, providerId);
  const downloads = installing(input.tools);

  const doing =
    downloads.length > 0
      ? `Downloading ${listed(downloads.map((id) => TOOL_WORDS.get(id) ?? id))} to ${input.hostInSentence}.`
      : stage === "checking"
        ? `Checking language tools on ${input.hostInSentence}.`
        : `Starting the language server on ${input.hostInSentence}.`;

  return {
    ...b,
    kind: "setting-up",
    mark: "hollow",
    pill: pill(input, "setting up"),
    title: `Setting up ${b.name}`,
    why: `${doing} Highlighting works meanwhile.`,
    progress: progressOf(input.tools),
    actions: providerId === null ? [] : [b.log],
  };
};

const syntax = (input: StatusInput, why: string): StatusView => {
  const b = base(input, null);

  return {
    ...b,
    kind: "syntax",
    mark: "none",
    pill: input.language,
    title: `${input.language} highlighting`,
    why,
    actions: [b.settings],
  };
};

/** What a missing Prerequisite is called and how to get it; Polaris never installs it. */
interface KnownPrerequisite {
  readonly name: string;
  readonly needs: string;
  readonly command?: string;
}

const PYTHON: KnownPrerequisite = {
  name: "Python",
  needs: "an interpreter",
  command: "uv python install",
};

const RUST: KnownPrerequisite = {
  name: "Rust",
  needs: "a Rust toolchain",
  command: "rustup toolchain install stable",
};

const PREREQUISITES = new Map<string, KnownPrerequisite>([
  ["python", PYTHON],
  ["python3", PYTHON],
  ["cargo", RUST],
  ["rustc", RUST],
  ["go", { name: "Go", needs: "a Go toolchain" }],
]);

const executableName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

type Prerequisite = (typeof P.LanguagePrerequisiteFact.Type)["requirement"] & {
  readonly reason: string;
};

export const missingPrerequisite = (providers: readonly Discovered[]): Prerequisite | null => {
  for (const provider of providers)
    for (const fact of provider.prerequisites)
      if (
        fact.requirement.required &&
        (fact.outcome === "missing" || fact.outcome === "incompatible")
      )
        return { ...fact.requirement, reason: fact.reason };

  return null;
};

const prerequisiteView = (input: StatusInput, missing: Prerequisite): StatusView => {
  const b = base(input, null);
  const executable = executableName(missing.executable);
  const known = PREREQUISITES.get(executable);

  return {
    ...b,
    kind: "prerequisite",
    mark: "hollow",
    pill: pill(input, `needs ${known?.name ?? executable}`),
    title: `${input.language} needs ${known?.needs ?? `${executable} ${missing.version}`}`,
    why: `${missing.reason} Polaris doesn't install ${known === undefined ? "it" : "toolchains"}.`,
    command: known?.command ?? null,
    commandHost: input.host,
    actions: [{ id: "check-again", label: "Check again" }, b.settings],
  };
};

const trustNeeded = (input: StatusInput, providerId: string | null): StatusView => {
  const b = base(input, providerId);

  return {
    ...b,
    kind: "trust",
    mark: "hollow",
    pill: pill(input, "needs Trust"),
    title: `${b.name} needs Trust`,
    why: `It would run ${input.workspace}'s own code on ${input.hostInSentence}. Trust ${input.workspace} to start it.`,
    actions: [{ id: "trust", label: `Trust ${input.workspace}…` }, b.log],
  };
};

interface FailureCopy {
  readonly word: string;
  readonly title: string;
  readonly why: string;
  readonly actions: readonly StatusAction[];
}

const failureView = (
  input: StatusInput,
  failure: NonNullable<FileLanguage["failure"]>
): StatusView => {
  const b = base(input, null);
  const checkAgain: StatusAction = { id: "check-again", label: "Check again" };

  const copy = Match.value(failure.reason).pipe(
    Match.when("not-installed", (): FailureCopy => ({
      word: "not downloaded",
      title: `${input.language} isn't downloaded`,
      why: `Download language tools automatically is off, and ${input.hostInSentence} doesn't have them yet.`,
      actions: [b.settings],
    })),
    Match.when("not-connected", (): FailureCopy => ({
      word: "offline",
      title: `Can't reach ${input.host}`,
      why: `${input.language} tools run on ${input.hostInSentence}. Highlighting works meanwhile.`,
      actions: [checkAgain],
    })),
    Match.orElse((): FailureCopy => ({
      word: "unavailable",
      title: `${input.language} tools didn't start`,
      why: `Polaris couldn't start them on ${input.hostInSentence}. Highlighting works meanwhile.`,
      actions: [checkAgain, b.settings],
    }))
  );

  return {
    ...b,
    kind: "unavailable",
    mark: "hollow",
    pill: pill(input, copy.word),
    title: copy.title,
    why: copy.why,
    actions: copy.actions,
  };
};

const lastLines = (text: string, count: number) =>
  text.replace(/\s+$/, "").split(/\r?\n/).slice(-count).join("\n");

const stopped = (
  input: StatusInput,
  providerId: string,
  runtime: Extract<Runtime, { _tag: "Stopped" }>
): StatusView => {
  const b = base(input, providerId);

  if (runtime.reason === "crash-budget") {
    const attempts = runtime.failure?.attempts ?? 3;
    const stderr = runtime.failure?.stderr ?? "";

    return {
      ...b,
      kind: "crashed",
      mark: "failed",
      tone: "failed",
      pill: pill(input, "stopped"),
      title: `${b.name} stopped`,
      why: `The server crashed ${attempts} times in 2 minutes, so Polaris stopped restarting it. ${stderr.trim() === "" ? "It wrote nothing to stderr." : "The last error is in the log."}`,
      stderr: stderr.trim() === "" ? null : lastLines(stderr, 6),
      actions: [b.restart, b.log],
    };
  }

  return {
    ...b,
    kind: "stopped",
    mark: "hollow",
    pill: pill(input, "stopped"),
    title: `${b.name} stopped`,
    why:
      runtime.reason === "connection-lost"
        ? `The connection to ${input.host} dropped while it ran.`
        : "The server isn't running. Restart it to get hover, completions and diagnostics back.",
    actions: [b.restart, b.log],
  };
};

const duration = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) return "just now";

  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

const trustText = (input: StatusInput, trust: TrustStatus) =>
  Match.value(decisionOf(trust.trust)).pipe(
    Match.when("trusted", () => `You trust ${input.workspace}`),
    Match.when("declined", () => "Not now"),
    Match.orElse(() => "Not asked yet")
  );

/** Whether the bundled TypeScript is a limit: the project has its own, or tsconfig plugins. */
const projectHasTypeScript = (trust: TrustStatus) =>
  trust.wouldRun.typescriptVersion !== null || trust.wouldRun.plugins.length > 0;

const serverFact = (
  input: StatusInput,
  provider: Discovered | undefined,
  runtime: ContextRuntime
) => {
  const launch = provider?.launch ?? null;
  const executable = launch === null ? null : executableName(launch.executable);
  const up = `up ${duration(input.now - runtime.since)}`;

  if (executable === null || executable === "node") {
    const v = version(input.tools, runtime.context.providerId);

    return {
      label: "Server",
      value: `${runtime.context.providerId}${v === null ? "" : ` ${v}`}`,
      mono: true,
      note: up,
    };
  }

  const args = (launch?.argv ?? []).filter((arg) => !arg.includes("/") && arg !== "--stdio");

  return { label: "Server", value: [executable, ...args].join(" "), mono: true, note: up };
};

const typescriptFacts = (input: StatusInput, trust: TrustStatus | null): Fact[] => {
  if (trust === null) return [];
  const bundledVersion = version(input.tools, "typescript");

  const ts: Fact =
    trust.provider === "project" && trust.wouldRun.typescriptVersion !== null
      ? {
          label: "TypeScript",
          value: trust.wouldRun.typescriptVersion,
          mono: true,
          note: "from this project",
        }
      : {
          label: "TypeScript",
          value: bundledVersion ?? "bundled",
          mono: bundledVersion !== null,
          note: bundledVersion === null ? undefined : "bundled",
        };

  return [ts];
};

const typescriptActions = (input: StatusInput, trust: TrustStatus | null): StatusAction[] => {
  if (trust === null) return [];
  const decision = decisionOf(trust.trust);
  const bundledVersion = version(input.tools, "typescript");

  if (trust.provider === "project")
    return [
      { id: "use-bundled", label: "Use bundled TypeScript", hint: bundledVersion ?? undefined },
    ];

  if (decision === "trusted")
    return [
      {
        id: "use-project",
        label: "Use project TypeScript",
        hint: trust.wouldRun.typescriptVersion ?? undefined,
      },
    ];

  return projectHasTypeScript(trust) ? [{ id: "trust", label: `Trust ${input.workspace}…` }] : [];
};

/** Why the bundled TypeScript runs although the project has its own. */
const bundledWhy = (input: StatusInput, trust: TrustStatus) => {
  const version = trust.wouldRun.typescriptVersion;
  const own = version === null ? "TypeScript" : `TypeScript ${version}`;

  return decisionOf(trust.trust) === "trusted"
    ? `You chose the bundled TypeScript for ${input.workspace}, so its own ${own} doesn't run.`
    : `You haven't trusted ${input.workspace}, so its own ${own} and tsconfig plugins don't run. Results may differ from tsc.`;
};

const ready = (input: StatusInput, runtime: ContextRuntime): StatusView => {
  const providerId = runtime.context.providerId;
  const b = base(input, providerId);
  const trust = providerId === TS ? input.trust : null;
  const limited = trust !== null && trust.provider === "bundled" && projectHasTypeScript(trust);
  const provider = input.file?.providers.find((value) => value.providerId === providerId);

  const facts: Fact[] = [
    ...typescriptFacts(input, trust),
    serverFact(input, provider, runtime),
    { label: "Host", value: input.host },
    ...(trust === null ? [] : [{ label: "Trust", value: trustText(input, trust) }]),
  ];

  const why =
    limited && trust !== null
      ? bundledWhy(input, trust)
      : "Hover, completions, go to definition and rename work in this file.";

  return {
    ...b,
    kind: limited ? "bundled" : "ready",
    mark: limited ? "hollow" : "filled",
    pill: pill(input, limited ? "bundled" : null),
    title: limited ? `${b.name} is ready, bundled` : `${b.name} is ready`,
    why,
    facts,
    actions: limited
      ? [...typescriptActions(input, trust), b.restart, b.log, b.settings]
      : [b.restart, ...typescriptActions(input, trust), b.log, b.settings],
  };
};

const runtimeView = (input: StatusInput, current: ContextRuntime): StatusView => {
  const providerId = current.context.providerId;

  return Match.value(current.runtime).pipe(
    Match.tag("Ready", () => ready(input, current)),
    Match.tag("Starting", () => settingUp(input, providerId, "starting")),
    Match.tag("AwaitingTrust", () => trustNeeded(input, providerId)),
    Match.tag("Stopped", (runtime) =>
      runtime.reason === "replaced"
        ? settingUp(input, providerId, "starting")
        : stopped(input, providerId, runtime)
    ),
    Match.tag("Failed", (runtime) => {
      const b = base(input, providerId);

      return {
        ...b,
        kind: "restarting" as const,
        mark: "hollow" as const,
        pill: pill(input, "restarting"),
        title: `Restarting the ${b.name} server`,
        why: `It exited unexpectedly (${runtime.attempts} so far). After 3 crashes in 2 minutes Polaris stops restarting it.`,
        actions: [b.log],
      };
    }),
    Match.tag("Unsupported", (runtime) => {
      const b = base(input, providerId);

      return {
        ...b,
        kind: "unavailable" as const,
        mark: "hollow" as const,
        pill: pill(input, "unavailable"),
        title: `${b.name} can't run here`,
        why: runtime.message,
        actions: [b.log, b.settings],
      };
    }),
    Match.exhaustive
  );
};

/** The provider that decides the pill: a crashed one first, then the first acquired. */
const leading = (runtimes: readonly ContextRuntime[]) =>
  runtimes.find(
    (value) =>
      Predicate.isTagged(value.runtime, "Stopped") && value.runtime.reason === "crash-budget"
  ) ?? runtimes[0];

const blockedByTrust = (providers: readonly Discovered[]) =>
  providers.length > 0 &&
  providers.every(
    (provider) =>
      Predicate.isTagged(provider.preflight, "Blocked") &&
      provider.preflight.reason === "awaiting-trust"
  );

const discoveredView = (input: StatusInput, file: FileLanguage): StatusView => {
  const current = leading(input.runtimes);

  if (current !== undefined) return runtimeView(input, current);
  const missing = missingPrerequisite(file.providers);

  if (missing !== null) return prerequisiteView(input, missing);

  if (blockedByTrust(file.providers))
    return trustNeeded(input, file.providers[0]?.providerId ?? null);

  if (file.providers.some((provider) => Predicate.isTagged(provider.preflight, "Eligible")))
    return settingUp(input, file.providers[0]?.providerId ?? null, "starting");

  return syntax(input, `Highlighting works. ${input.language} has no language server yet.`);
};

export const statusView = (input: StatusInput): StatusView => {
  const file = input.file;

  if (file === null || file.phase === "local")
    return syntax(
      input,
      `Highlighting works. Language tools run on ${input.hostInSentence} once it's connected.`
    );

  if (file.phase === "checking") return settingUp(input, null, "checking");

  if (file.phase === "failed" && file.failure !== null) {
    if (file.failure.reason === "awaiting-trust") return trustNeeded(input, null);

    if (file.failure.reason === "missing-prerequisite") {
      const missing = missingPrerequisite(file.providers);

      if (missing !== null) return prerequisiteView(input, missing);
    }

    return failureView(input, file.failure);
  }

  return discoveredView(input, file);
};

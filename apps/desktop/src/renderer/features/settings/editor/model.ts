/**
 * Settings → Editor → Languages (DESIGN.md, Settings: Editor · languages; Paper L4):
 * one row per Language Integration on the picked Host, from its catalog and
 * availability facts. Facts the protocol doesn't give are left out, never guessed.
 */
import * as P from "@polaris/protocol";
import { Match, Predicate } from "effect";
import { LANGUAGES, LANGUAGE_IDS, type LanguageId } from "../../editor/model/language.ts";

type Catalog = P.LanguageCatalog;

type Integration = Catalog["integrations"][number];

type Availability = P.LanguageAvailability;

type Requirement = Availability["prerequisites"][number]["requirement"];

export interface Fact {
  readonly label: string;
  readonly value: string;
  readonly mono: boolean;
  readonly note?: string;
}

export interface LanguageRow {
  /** The primary server's tool: integrations sharing one server share a row. */
  readonly id: string;
  readonly name: string;
  readonly monogram: string;
  readonly state: string;
  readonly syntaxIds: ReadonlyArray<P.LanguageSyntaxId>;
  readonly facts: ReadonlyArray<Fact>;
}

export interface RowContext {
  /** "this Mac" or the Host's name, for running text. */
  readonly host: string;
  readonly downloadAutomatically: boolean;
}

const NAMES = new Map<string, string>([
  ["typescript", "TypeScript and JavaScript"],
  ["html", "HTML"],
  ["css", "CSS"],
  ["bash", "Shell"],
  ["php", "PHP"],
  ["sql", "SQL"],
  ["yaml", "YAML"],
  ["actions", "GitHub Actions"],
]);

const MONOGRAMS = new Map<string, string>([
  ["typescript", "TS"],
  ["python", "PY"],
  ["rust", "RS"],
  ["bash", "SH"],
  ["css", "{}"],
  ["html", "{}"],
  ["yaml", "YM"],
  ["actions", "YM"],
  ["prisma", "PR"],
]);

/** What the row adds after "Ready" for an integration with something to say. */
const READY_NOTES = new Map<string, string>([
  ["typescript", "uses each project's TypeScript once you trust it"],
]);

const ROLE_LABELS = {
  primary: "Language server",
  lint: "Linter",
  expressions: "Expressions",
} as const;

const BY_DOCUMENT_ID = new Map<string, LanguageId>(
  LANGUAGE_IDS.map((id) => [LANGUAGES[id].documentLanguageId, id])
);

const SYNTAX_IDS = new Set<string>(P.LanguageSyntaxId.literals);

const isSyntaxId = (id: string): id is P.LanguageSyntaxId => SYNTAX_IDS.has(id);

export const syntaxIdsOf = (integration: Integration): ReadonlyArray<P.LanguageSyntaxId> =>
  integration.languageIds.flatMap((documentId) => {
    const id = BY_DOCUMENT_ID.get(documentId);

    return id !== undefined && isSyntaxId(id) ? [id] : [];
  });

const nameOf = (integration: Integration) => {
  const named = NAMES.get(integration.id);

  if (named !== undefined) return named;
  const first = syntaxIdsOf(integration)[0];

  return first === undefined ? integration.id : LANGUAGES[first].name;
};

const listed = (names: ReadonlyArray<string>) =>
  names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const versionOf = (availability: Availability | undefined, pinned: string) =>
  availability === undefined
    ? pinned
    : Match.value(availability.installation).pipe(
        Match.tag("Installed", (installed) => installed.version),
        Match.orElse(() => availability.pinnedVersion)
      );

const versionWords = (version: string) =>
  version === "present" ? "" : version.replace(/^>=\s*/, "") + " or newer";

/** A required prerequisite the Host lacks, in words. */
const missingPrerequisite = (facts: ReadonlyArray<Availability>, host: string) => {
  const fact = facts
    .flatMap((availability) => availability.prerequisites)
    .find(
      (p) => p.requirement.required && (p.outcome === "missing" || p.outcome === "incompatible")
    );

  if (fact === undefined) return null;
  const version = versionWords(fact.requirement.version);

  return `Needs ${fact.requirement.executable}${version ? ` ${version}` : ""} on ${host}`;
};

const installState = (facts: ReadonlyArray<Availability>) => {
  const installing = facts.find((f) => Predicate.isTagged(f.installation, "Installing"));

  if (installing !== undefined) return `Setting up · downloading ${installing.toolId}`;
  const failed = facts.find((f) => Predicate.isTagged(f.installation, "Failed"));

  if (failed !== undefined) return `Couldn't download ${failed.toolId}`;

  return null;
};

const blockedState = (facts: ReadonlyArray<Availability>, host: string) => {
  const blocked = facts
    .map((f) => f.preflight)
    .find((preflight) => Predicate.isTagged(preflight, "Blocked"));

  if (blocked === undefined || !Predicate.isTagged(blocked, "Blocked")) return null;

  return Match.value(blocked.reason).pipe(
    Match.when("unsupported-platform", () => `Not available on ${host}`),
    Match.when("not-offered", () => "Not offered yet"),
    Match.when("not-connected", () => `Waiting for ${host}`),
    Match.orElse(() => null)
  );
};

const notDownloaded = (
  servers: ReadonlyArray<string>,
  syntax: P.LanguageSyntaxId | undefined,
  auto: boolean
) => {
  if (!auto) return "Not downloaded yet · downloading is off";
  const extension = syntax === undefined ? undefined : LANGUAGES[syntax].extensions[0];
  const file = extension === undefined ? "file" : `.${extension} file`;
  const verb = servers.length > 1 ? "arrive" : "arrives";

  return `Not downloaded yet · ${listed(servers)} ${verb} with your first ${file}`;
};

const stateOf = (
  integrationId: string,
  servers: ReadonlyArray<string>,
  syntaxIds: ReadonlyArray<P.LanguageSyntaxId>,
  facts: ReadonlyArray<Availability>,
  context: RowContext
) => {
  const urgent =
    installState(facts) ??
    missingPrerequisite(facts, context.host) ??
    blockedState(facts, context.host);

  if (urgent !== null) return urgent;

  if (facts.length > 0 && facts.every((f) => Predicate.isTagged(f.installation, "Installed"))) {
    const note = READY_NOTES.get(integrationId);

    return note === undefined ? "Ready" : `Ready · ${note}`;
  }

  return facts.length === 0
    ? "Not checked yet"
    : notDownloaded(servers, syntaxIds[0], context.downloadAutomatically);
};

const runtimeFact = (
  requirement: Requirement,
  availability: ReadonlyMap<string, Availability>,
  tools: ReadonlyMap<string, Catalog["tools"][number]>,
  prerequisite: Availability["prerequisites"][number] | undefined,
  host: string
): Fact => {
  const managed = tools.get(requirement.executable);

  if (managed !== undefined)
    return {
      label: "Runs on",
      value: `${requirement.executable} ${versionOf(availability.get(managed.id), managed.version)}`,
      mono: true,
      note: "Polaris's own",
    };

  const detected = prerequisite?.detectedVersion ?? null;

  return {
    label: "Runs on",
    value: detected === null ? requirement.executable : `${requirement.executable} ${detected}`,
    mono: true,
    note: prerequisite?.outcome === "satisfied" ? `from ${host}` : `not found on ${host}`,
  };
};

const FORMATTER_NOTES = {
  managed: "pinned by Polaris, using the project's config",
  developer: "yours, on the host",
  configured: "set under Advanced",
} as const;

const factsOf = (
  group: ReadonlyArray<Integration>,
  catalog: Catalog,
  availability: ReadonlyMap<string, Availability>,
  host: string
): ReadonlyArray<Fact> => {
  const tools = new Map(catalog.tools.map((tool) => [tool.id, tool]));

  const providers = [
    ...new Map(group.flatMap((i) => i.providers).map((p) => [p.tool, p])).values(),
  ];

  const facts: Fact[] = [];

  for (const provider of providers) {
    const tool = tools.get(provider.tool);

    if (tool === undefined) continue;
    facts.push({
      label: ROLE_LABELS[provider.role],
      value: `${tool.id} ${versionOf(availability.get(tool.id), tool.version)}`,
      mono: true,
    });
  }

  const bundled = group.some((i) => i.id === "typescript") ? tools.get("typescript") : undefined;

  if (bundled !== undefined)
    facts.push({
      label: "Bundled TypeScript",
      value: versionOf(availability.get(bundled.id), bundled.version),
      mono: true,
      note: "for workspaces you haven't trusted",
    });

  const primary = tools.get(providers[0]?.tool ?? "");
  const server = primary?.requirements.find((r) => r.scope === "server");

  if (primary !== undefined && server !== undefined) {
    const prerequisite = availability
      .get(primary.id)
      ?.prerequisites.find((p) => p.requirement.id === server.id);

    facts.push(runtimeFact(server, availability, tools, prerequisite, host));
  }

  const formatter = group[0]?.formatter;

  if (formatter !== undefined)
    facts.push({
      label: "Formatter",
      value: formatter.tool,
      mono: true,
      note: FORMATTER_NOTES[formatter.source],
    });

  return facts;
};

/** Every tool a row needs facts for: servers, companions, formatters and managed runtimes. */
export const toolIdsOf = (catalog: Catalog): ReadonlyArray<string> => {
  const tools = new Set(catalog.tools.map((tool) => tool.id));

  const ids = catalog.integrations.flatMap((i) => [
    ...i.providers.map((p) => p.tool),
    ...i.companions,
    i.formatter.tool,
  ]);

  return [...new Set([...ids, "node", "typescript"])].filter((id) => tools.has(id));
};

export const languageRows = (
  catalog: Catalog,
  availability: ReadonlyArray<Availability>,
  context: RowContext
): ReadonlyArray<LanguageRow> => {
  const byTool = new Map(availability.map((a) => [a.toolId, a]));
  const groups = new Map<string, Integration[]>();

  for (const integration of catalog.integrations) {
    const key = integration.providers[0]?.tool ?? integration.id;
    groups.set(key, [...(groups.get(key) ?? []), integration]);
  }

  return [...groups.entries()].flatMap(([key, group]) => {
    const first = group[0];

    if (first === undefined) return [];
    const syntaxIds = [...new Set(group.flatMap(syntaxIdsOf))];
    const servers = [...new Set(group.flatMap((i) => i.providers.map((p) => p.tool)))];

    const facts = servers.flatMap((id) => {
      const fact = byTool.get(id);

      return fact === undefined ? [] : [fact];
    });

    const row: LanguageRow = {
      id: key,
      name: listed([...new Set(group.map(nameOf))].sort((a, b) => a.length - b.length)),
      monogram: MONOGRAMS.get(first.id) ?? nameOf(first).slice(0, 2).toUpperCase(),
      state: stateOf(first.id, servers, syntaxIds, facts, context),
      syntaxIds,
      facts: factsOf(group, catalog, byTool, context.host),
    };

    return [row];
  });
};

/** Most-used first, so the foot line names the languages people look for. */
const SYNTAX_ORDER: ReadonlyArray<LanguageId> = ["c", "cpp", "csharp", "ruby", "json", "toml"];

const NOT_LANGUAGES = new Set<LanguageId>(["markdown", "plain", "diff"]);

/** Languages the editor highlights that no integration serves (Markdown has its own row). */
export const syntaxOnly = (catalog: Catalog): ReadonlyArray<string> => {
  const served = new Set<string>(catalog.integrations.flatMap(syntaxIdsOf));
  const rank = (id: LanguageId) => SYNTAX_ORDER.indexOf(id) >>> 0;

  return LANGUAGE_IDS.filter((id) => !served.has(id) && !NOT_LANGUAGES.has(id))
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => LANGUAGES[id].name);
};

export const syntaxOnlyLine = (names: ReadonlyArray<string>) => {
  if (names.length === 0) return null;
  const subject = names.length <= 4 ? listed(names) : `${names.slice(0, 4).join(", ")} and others`;

  return `${subject} highlight their syntax, with no language server yet.`;
};

/** Off means every language of the row has an explicit empty provider list. */
export const rowEnabled = (
  row: LanguageRow,
  records: Readonly<Partial<Record<P.LanguageSyntaxId, P.LanguageSettingsPatch>>>
) =>
  row.syntaxIds.length === 0 || !row.syntaxIds.every((id) => records[id]?.providers?.length === 0);

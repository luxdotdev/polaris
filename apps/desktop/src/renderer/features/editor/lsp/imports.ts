/**
 * The language coordinator's side of import Edit Predictions: the buffer's current diagnostics,
 * the burst's unresolved names, their quick fixes on their own lanes, then the selection rule.
 * The answer stays fenced by each request's provider acknowledgment and buffer version (ADR-0048).
 */
import { type LspDiagnostic as NameDiagnostic, unresolvedInBurst } from "@polaris/predict";
import type * as P from "@polaris/protocol";
import { Option, Schema } from "effect";
import {
  type ImportAction,
  type ImportBurst,
  type ImportCandidate,
  type ImportSource,
  isUnresolvedName,
  selectImportAction,
} from "../prediction/imports/index.ts";
import type { LanguageDiagnosticFeed, ProviderDiagnostics } from "./diagnostics.ts";
import type { LanguageFeatures } from "./features.ts";
import * as Payload from "./payloads.ts";
import { offsetAt } from "./position.ts";
import type { LanguageBuffer, LanguageProvider } from "./types.ts";

type Diagnostic = typeof P.LanguageDiagnostic.Type;

type JsonObject = typeof P.LanguageJsonObject.Type;

type Action = NonNullable<typeof Payload.CodeActions.Type>[number];

/** At most this many unresolved actions are resolved before selection. */
const MAX_RESOLVED = 4;

/** At most this many of a burst's unresolved names are asked about; the study saw three. */
const MAX_NAMES = 4;

export interface ImportSourceDeps {
  readonly features: LanguageFeatures;
  readonly diagnostics: LanguageDiagnosticFeed;
  readonly read: () => LanguageBuffer;
}

interface Target {
  readonly provider: LanguageProvider;
  readonly item: Diagnostic;
  readonly from: number;
  readonly to: number;
}

/** Resolves with the buffer's current diagnostic sets once any provider has one, or null on abort. */
const settled = (feed: LanguageDiagnosticFeed, signal: AbortSignal) =>
  new Promise<readonly ProviderDiagnostics[] | null>((resolve) => {
    if (signal.aborted) {
      resolve(null);

      return;
    }

    let stop = () => {};

    const done = (value: readonly ProviderDiagnostics[] | null) => {
      stop();
      signal.removeEventListener("abort", abort);
      resolve(value);
    };

    const abort = () => done(null);

    const check = () => {
      const values = feed.values();

      if (values.length > 0) done(values);
    };

    signal.addEventListener("abort", abort, { once: true });
    stop = feed.observe(check);
    check();
  });

const span = (buffer: LanguageBuffer, provider: LanguageProvider, item: Diagnostic) => {
  try {
    const encoding = provider.capabilities.positionEncoding;

    return {
      from: offsetAt(buffer.doc, item.range.start, encoding),
      to: offsetAt(buffer.doc, item.range.end, encoding),
    };
  } catch {
    return null;
  }
};

/** The unresolved name in `range` nearest its end. */
const unresolvedIn = (
  sets: readonly ProviderDiagnostics[],
  buffer: LanguageBuffer,
  range: { readonly from: number; readonly to: number }
): Target | null => {
  const targets = sets.flatMap(({ provider, diagnostics }) =>
    diagnostics.items.flatMap((item) => {
      const at = isUnresolvedName(item) ? span(buffer, provider, item) : null;

      return at !== null && at.from <= range.to && at.to >= range.from
        ? [{ provider, item, ...at }]
        : [];
    })
  );

  return targets.sort((a, b) => b.to - a.to)[0] ?? null;
};

const cue = (item: Diagnostic): NameDiagnostic =>
  item.code === null
    ? { range: item.range, message: item.message }
    : { range: item.range, message: item.message, code: item.code };

const burstLineSet = (buffer: LanguageBuffer, burst: ImportBurst) => {
  const lines = new Set<number>();

  for (let n = buffer.doc.lineAt(burst.from).number; n <= buffer.doc.lineAt(burst.to).number; n++)
    lines.add(n - 1);

  return lines;
};

/** TypeScript's unresolved names the burst touched, on one provider, in document order. */
const burstNames = (
  sets: readonly ProviderDiagnostics[],
  buffer: LanguageBuffer,
  burst: ImportBurst
): Target[] => {
  const scope = { lines: burstLineSet(buffer, burst), names: burst.names };

  for (const { provider, diagnostics } of sets) {
    const cues = diagnostics.items.filter(isUnresolvedName).map((item) => ({ ...cue(item), item }));

    const targets = unresolvedInBurst(cues, scope).flatMap(({ item }) => {
      const at = span(buffer, provider, item);

      return at === null ? [] : [{ provider, item, ...at }];
    });

    if (targets.length > 0) return targets.sort((a, b) => a.from - b.from).slice(0, MAX_NAMES);
  }

  return [];
};

/** The burst's TypeScript names, else (other servers) the one nearest the burst's end. */
const targetsIn = (
  sets: readonly ProviderDiagnostics[],
  buffer: LanguageBuffer,
  burst: ImportBurst
): Target[] => {
  const named = burstNames(sets, buffer, burst);

  if (named.length > 0) return named;
  const nearest = unresolvedIn(sets, buffer, burst);

  return nearest === null ? [] : [nearest];
};

/** The diagnostic as LSP sends it: absent fields omitted rather than null. */
type LspDiagnostic = {
  range: Diagnostic["range"];
  message: string;
  severity?: 1 | 2 | 3 | 4;
  code?: string | number;
  source?: string;
  data?: typeof P.LanguageJson.Type;
  tags?: Array<1 | 2>;
};

const lspDiagnostic = (item: Diagnostic): JsonObject => {
  const out: LspDiagnostic = {
    range: item.range,
    message: item.message,
  };

  if (item.severity !== null) out.severity = item.severity;

  if (item.code !== null) out.code = item.code;

  if (item.source !== null) out.source = item.source;

  if (item.data !== undefined) out.data = item.data;

  if (item.tags.length > 0) out.tags = [...item.tags];

  return out;
};

const resolvedActions = async (
  features: LanguageFeatures,
  provider: LanguageProvider,
  actions: readonly Action[],
  signal: AbortSignal,
  name: number
): Promise<readonly ImportAction[]> => {
  const open = actions.filter((action) => action.edit === undefined && action.data !== undefined);

  if (open.length === 0 || open.length > MAX_RESOLVED) return actions;

  return Promise.all(
    actions.map(async (action, i) => {
      if (!open.includes(action)) return action;

      const answers = await features.resolve(
        provider,
        "codeAction/resolve",
        action,
        signal,
        `codeAction/resolve-import-${name}-${i}`
      );

      const result = answers[0]?.value.result;

      return Option.getOrElse(Schema.decodeUnknownOption(Payload.CodeAction)(result), () => action);
    })
  );
};

/** One name's quick fixes from its own provider, resolved; null when that provider gave none. */
const fixesFor = async (deps: ImportSourceDeps, target: Target, i: number, signal: AbortSignal) => {
  const answers = await deps.features.quickFixes(
    target.from,
    target.to,
    lspDiagnostic(target.item),
    signal,
    `quickfix-import-${i}`
  );

  const answer = answers.find(
    (entry) => entry.provider.context.contextId === target.provider.context.contextId
  );

  if (answer === undefined || signal.aborted) return null;
  const actions = await resolvedActions(deps.features, answer.provider, answer.payload, signal, i);

  return { answer, name: { diagnostic: cue(target.item), actions } };
};

const find = async (
  deps: ImportSourceDeps,
  burst: ImportBurst,
  signal: AbortSignal
): Promise<ImportCandidate | null> => {
  const sets = await settled(deps.diagnostics, signal);

  if (sets === null) return null;

  const buffer = deps.read();
  const targets = targetsIn(sets, buffer, burst);
  const found = await Promise.all(targets.map((target, i) => fixesFor(deps, target, i, signal)));
  const fixes = found.filter((fix) => fix !== null);
  const [first] = fixes;

  if (first === undefined || signal.aborted) return null;
  const document = { uri: buffer.uri, version: buffer.version, text: buffer.doc.toString() };

  const choice = selectImportAction(
    document,
    fixes.map((fix) => fix.name)
  );

  if (choice === null || signal.aborted) return null;
  const encoding = first.answer.provider.capabilities.positionEncoding;

  try {
    const hunks = choice.inserts
      .map((insert) => {
        const at = offsetAt(buffer.doc, insert.at, encoding);

        return { from: at, to: at, text: insert.text };
      })
      .sort((a, b) => a.from - b.from);

    return {
      title: choice.title,
      hunks,
      doc: buffer.doc,
      current: () =>
        fixes.every(
          ({ answer }) =>
            deps.features.requests.intentCurrent(answer.provider, buffer, answer.request.fence) &&
            answer.request.requestId === answer.value.requestId
        ),
    };
  } catch {
    return null;
  }
};

export const languageImportSource = (deps: ImportSourceDeps): ImportSource => ({
  find: (burst, signal) => find(deps, burst, signal).catch(() => null),
});

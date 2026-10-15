/**
 * The language coordinator's side of the diagnostics verifier: the edited text goes to a shadow
 * document on the file's provider, both documents' errors are read, and `verifyDiagnostics`
 * decides. Nothing here paints: the shadow's diagnostics never reach a feed or the Problems view.
 */
import { ChangeSet, type Text } from "@codemirror/state";
import {
  type BufferDiagnostic,
  type DiagnosticsVerdict,
  shadowedImports,
  UNRESOLVED_NAME_CODES,
  verifyDiagnostics,
} from "@polaris/predict";
import type { LanguageApi } from "../../../../shared/api.ts";
import type { LanguageId } from "../model/language.ts";
import type { DiagnosticsVerifier, VerifyInput } from "../prediction/verify/index.ts";
import { diagnosticsReader, type Located } from "./verifyRequests.ts";
import type { LanguageFeatures } from "./features.ts";
import type { EditorLanguageSession } from "./sessions.ts";
import { holdShadow, shadowable, shadowUri } from "./shadows.ts";
import { bufferText, type LanguageBuffer, type LanguageProvider } from "./types.ts";

/** The coordinator's entry, read live. */
export interface VerifierEntry {
  readonly features: LanguageFeatures;
  readonly read: () => LanguageBuffer;
  readonly language: LanguageId;
  readonly groups: readonly EditorLanguageSession[];
}

interface VerifierDeps {
  readonly entry: VerifierEntry;
  readonly api: LanguageApi;
}

const IMPORT_FIX = /^(?:Add|Update) import from/;

/** At most this many stand-in candidates are asked about; the research cases had one or two. */
const MAX_STAND_INS = 4;

/** A Host that never acknowledges the close must not hold the context's requests for long. */
const RELEASE_MS = 5000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const abortedWith = <T>(value: T, signal: AbortSignal) =>
  new Promise<T>((resolve) => {
    if (signal.aborted) resolve(value);
    else signal.addEventListener("abort", () => resolve(value), { once: true });
  });

const sessionOf = (deps: VerifierDeps, provider: LanguageProvider) =>
  deps.entry.groups.find((session) => session.acquisition.contextId === provider.context.contextId);

/** The first provider that can check a shadow, with its session. */
const checker = (deps: VerifierDeps) => {
  for (const provider of deps.entry.features.options.providers()) {
    const read = diagnosticsReader(deps.api, provider);
    const session = read && sessionOf(deps, provider);

    if (read && session) return { provider, read, session };
  }

  return null;
};

const edited = (doc: Text, edits: VerifyInput["edits"]) =>
  ChangeSet.of(
    edits.map((edit) => ({ from: edit.from, to: edit.to, insert: edit.text })),
    doc.length
  ).apply(doc);

/** Before and after errors, read while the shadow is open; it closes however this ends. */
const diagnose = async (
  deps: VerifierDeps,
  input: VerifyInput,
  buffer: LanguageBuffer,
  signal: AbortSignal
) => {
  const found = checker(deps);
  const after = edited(input.doc, input.edits);
  const text = bufferText({ ...buffer, doc: after });
  const uri = shadowUri(buffer.uri);

  if (found === null || uri === null || !shadowable(deps.entry.language, uri, text)) return null;
  const release = await holdShadow(found.provider.context.contextId, signal);

  if (release === null) return null;

  const opening = found.session.openShadow(uri, deps.entry.language, text);

  try {
    const opened = await Promise.race([opening, abortedWith(null, signal)]);

    if (opened === null || signal.aborted) return null;

    const fence = [
      { uri: buffer.uri, version: buffer.version },
      { uri, version: 1 },
    ];

    const [before, shadow] = await Promise.all([
      found.read(opened, fence, buffer.uri, input.doc, signal),
      found.read(opened, fence, uri, after, signal),
    ]);

    return { before, after: shadow };
  } finally {
    const closed = opening.then((value) => value && found.session.closeShadow(uri));
    void Promise.race([closed, delay(RELEASE_MS)]).then(release);
  }
};

/** Errors the server offers to fix with an import; asked only after the shadow closed. */
const importable = async (
  deps: VerifierDeps,
  candidates: readonly Located[],
  signal: AbortSignal
): Promise<Located[]> => {
  const fixable = await Promise.all(
    candidates.slice(0, MAX_STAND_INS).map(async (candidate, i) => {
      const answers = await deps.entry.features.quickFixes(
        candidate.from,
        candidate.to,
        {
          range: candidate.range,
          message: candidate.message,
          code: Number(candidate.code),
          severity: 1,
        },
        signal,
        `quickfix-verify-${i}`
      );

      return answers.some(({ payload }) => payload.some((action) => IMPORT_FIX.test(action.title)))
        ? [candidate]
        : [];
    })
  );

  return fixable.flat();
};

const verify = async (
  deps: VerifierDeps,
  input: VerifyInput,
  signal: AbortSignal
): Promise<DiagnosticsVerdict | null> => {
  const buffer = deps.entry.read();

  if (buffer.doc !== input.doc) return null;
  const read = await diagnose(deps, input, buffer, signal);

  if (read === null || signal.aborted) return null;
  const check = { buffer: input.doc.toString(), edits: input.edits, cursor: input.cursor, ...read };
  const verdict = verifyDiagnostics(check);

  if (!verdict.allow) return verdict;

  const unresolved = read.before.filter(
    (item) => item.severity === "error" && UNRESOLVED_NAME_CODES.has(Number(item.code))
  );

  const shadowed = new Set<BufferDiagnostic>(shadowedImports({ ...check, importable: unresolved }));
  const candidates = unresolved.filter((item) => shadowed.has(item));

  if (candidates.length === 0) return verdict;

  return verifyDiagnostics({ ...check, importable: await importable(deps, candidates, signal) });
};

export const languageDiagnosticsVerifier = (
  entry: VerifierEntry,
  api: LanguageApi
): DiagnosticsVerifier => {
  const deps: VerifierDeps = { entry, api };

  return {
    attached: (doc) => {
      const buffer = deps.entry.read();

      return (
        buffer.doc === doc &&
        checker(deps) !== null &&
        shadowable(deps.entry.language, buffer.uri, doc.toString())
      );
    },
    verify: (input, signal) => verify(deps, input, signal).catch(() => null),
  };
};

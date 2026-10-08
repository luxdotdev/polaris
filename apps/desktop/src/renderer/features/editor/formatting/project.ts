import * as P from "@polaris/protocol";
import { Match, Predicate, Schema } from "effect";
import type { LanguageApi } from "../../../../shared/api.ts";
import { languageIpcError } from "../../../../shared/languageError.ts";
import type { FormatSnapshot } from "./index.ts";

/** Who formats a file: its language server, the project's own formatter, or nobody. */
export type FormatRoute = "server" | "project" | "ignored";

/**
 * A formatter chosen in Settings wins; with none (automatic), the project's own formatter, and
 * only without one the language server's. A file the project's ignore files exclude stays as typed.
 */
export const formatRoute = (
  formatter: P.LanguageFormatterSelection,
  project: P.LanguageProjectFormatter | null | undefined
): FormatRoute =>
  !Predicate.isTagged(formatter, "None") || project === null || project === undefined
    ? "server"
    : project.ignored
      ? "ignored"
      : "project";

export const untrustedFormatting = (tool: string, workspace: string) =>
  `Formatting uses ${tool} once you trust ${workspace}.`;

const changed = () => new Error("Formatter document changed.");

/** The version fence: only this request's answer, for this buffer version, may change the text. */
export const projectFormattedText = (
  outcome: P.LanguageProjectFormatOutcome,
  requestId: string,
  snapshot: Pick<FormatSnapshot, "text" | "version">
): string => {
  if (outcome.requestId !== requestId) throw changed();

  return Match.value(outcome).pipe(
    Match.tag("Formatted", (value) => {
      if (value.version !== snapshot.version) throw changed();

      return value.text;
    }),
    Match.tag("Skipped", (value) => {
      if (value.version !== snapshot.version) throw changed();

      return snapshot.text;
    }),
    Match.tag("Failed", (value) => {
      throw new Error(value.message.endsWith(".") ? value.message : `${value.message}.`);
    }),
    Match.exhaustive
  );
};

export interface ProjectFormatTarget {
  readonly hostKey: string;
  readonly checkout: P.LanguageCheckout;
  readonly path: string;
  readonly tool: string;
  readonly workspace: string;
}

/**
 * The Daemon runs the project's formatter only in a trusted checkout. Untrusted, a save keeps the
 * text as typed (never the server's style instead) and Format document explains why.
 */
export const formatWithProject = async (
  api: LanguageApi,
  target: ProjectFormatTarget,
  snapshot: FormatSnapshot,
  signal: AbortSignal
): Promise<string> => {
  const requestId = `format-${crypto.randomUUID()}`;

  const answer = await api.request("languages.format.project", {
    hostKey: target.hostKey,
    checkout: target.checkout,
    path: target.path,
    requestId,
    version: snapshot.version,
    text: snapshot.text,
    deadline: Date.now() + 3000,
  });

  if (signal.aborted) throw new Error("Formatting cancelled.");

  if (!answer.ok) {
    const error = languageIpcError(answer.error);

    if (error.reason !== "awaiting-trust") throw new Error(error.message);

    if (snapshot.command === true)
      throw new Error(untrustedFormatting(target.tool, target.workspace));

    return snapshot.text;
  }

  return projectFormattedText(
    Schema.decodeUnknownSync(P.LanguageProjectFormatOutcome)(answer.value),
    requestId,
    snapshot
  );
};

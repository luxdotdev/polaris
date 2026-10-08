/**
 * The Editor's part of the command context (the focused file's language, its
 * servers and how its checkout is trusted) and the follow-ups the language
 * commands ask. Pure, so the palette's availability rules are tested here.
 */
import type { ContextKey, ContextValue } from "../../../../shared/keymap.ts";
import type { ContextPart, FollowUp, FollowUpChoice } from "../../../routes/commands.ts";
import { LANGUAGE_NAMES, type LanguageId } from "../model/language.ts";
import { decisionOf, isReviewScope, trustCopy, type TrustStatus } from "../trust/model.ts";

/** TypeScript and JavaScript files run through the TypeScript provider. */
const TYPESCRIPT: ReadonlySet<LanguageId> = new Set(["typescript", "tsx", "javascript", "jsx"]);

export interface FocusedFile {
  readonly path: string;
  readonly language: LanguageId;
  /** The provider keys serving it ("typescript-language-server"), as discovery found them. */
  readonly providers: ReadonlyArray<string>;
  readonly status: TrustStatus | null;
  readonly workspace: string;
  /** A server serving it formats documents (`textDocument/formatting`). */
  readonly canFormat: boolean;
  /** A log tab is listening (`intents/languageLog.ts`). */
  readonly canShowLog: boolean;
  /** Its checkout is known, so a Python file's interpreters can be listed. */
  readonly hasCheckout: boolean;
  /** "uv · 3.12.4" once the Host has listed them, else "". */
  readonly pythonInterpreter: string;
}

const basename = (path: string) => path.split("/").pop() ?? path;

/** "polaris", or "this review checkout": what Trust is about in titles. */
export const trustSubject = (status: TrustStatus, workspace: string) =>
  isReviewScope(status) ? "this review checkout" : workspace;

export const typescriptChoice = (status: TrustStatus) => {
  const version = status.wouldRun.typescriptVersion;

  return version === null ? "bundled" : `project ${version} or bundled`;
};

const trustKeys = (status: TrustStatus | null): ReadonlyArray<ContextKey> => {
  if (status === null) return [];
  const decision = decisionOf(status.trust);

  return [
    "trust.known",
    decision === "trusted" ? "trust.trusted" : null,
    decision === "declined" ? "trust.declined" : null,
    decision === "undecided" ? "trust.undecided" : null,
  ].filter((k): k is ContextKey => k !== null);
};

export const fileContext = (file: FocusedFile | null): ContextPart => {
  if (file === null) return {};
  const hasServer = file.providers.length > 0;

  const keys: Array<ContextKey> = ["editor.file", ...trustKeys(file.status)];

  if (hasServer) keys.push("language.server");

  if (hasServer && file.canFormat) keys.push("language.formatter");

  if (file.canShowLog) keys.push("language.log");

  if (TYPESCRIPT.has(file.language) && file.status !== null) keys.push("language.typescript");

  if (file.language === "python" && file.hasCheckout) keys.push("language.python");

  const values: Partial<Record<ContextValue, string>> = {
    language: LANGUAGE_NAMES[file.language],
    file: basename(file.path),
  };

  if (file.pythonInterpreter !== "") values.pythonInterpreter = file.pythonInterpreter;

  if (file.status !== null) {
    values.trustSubject = trustSubject(file.status, file.workspace);
    values.typescriptChoice = typescriptChoice(file.status);
  }

  return { keys, values };
};

export type TypeScriptSource = "use-project" | "use-bundled";

/** "Select TypeScript version…": the project's (with Trust) or the bundled one. */
export const typescriptFollowUp = (
  status: TrustStatus,
  workspace: string,
  choose: (source: TypeScriptSource) => void
): FollowUp => {
  const version = status.wouldRun.typescriptVersion;
  const trusted = decisionOf(status.trust) === "trusted";
  const subject = trustSubject(status, workspace);

  const projectDetail = () => {
    if (version === null) return `No TypeScript in ${subject}`;

    if (!trusted) return `Needs trust in ${subject}`;

    return status.provider === "project" ? "In use" : "";
  };

  const project: FollowUpChoice = {
    id: "use-project",
    title:
      version === null ? "Use the project's TypeScript" : `Use the project's TypeScript ${version}`,
    detail: projectDetail(),
    disabled: version === null || !trusted,
    run: () => choose("use-project"),
  };

  const bundled: FollowUpChoice = {
    id: "use-bundled",
    title: "Use the bundled TypeScript",
    detail: status.provider === "bundled" ? "In use" : "",
    run: () => choose("use-bundled"),
  };

  return { title: "Select TypeScript version", choices: [project, bundled] };
};

/** "Trust polaris…": what Trust would run, as the Trust card says it, then the answer. */
export const trustFollowUp = (
  status: TrustStatus,
  workspace: string,
  host: string,
  decide: (action: "trust" | "decline") => void
): FollowUp => {
  const copy = trustCopy(status, workspace, host);
  const undecided = decisionOf(status.trust) === "undecided";

  const trust: FollowUpChoice = { id: "trust", title: copy.trust, run: () => decide("trust") };

  const notNow: FollowUpChoice = {
    id: "decline",
    title: "Not now",
    detail: "The bundled TypeScript keeps checking your code",
    run: () => decide("decline"),
  };

  return { title: copy.title, note: copy.body, choices: undecided ? [trust, notNow] : [trust] };
};

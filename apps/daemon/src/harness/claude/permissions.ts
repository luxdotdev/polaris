/**
 * Polaris permission modes and approval decisions, mapped onto Claude Code's.
 */
import type {
  PermissionMode as ClaudePermissionMode,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalDecision, ApprovalKind, PermissionMode } from "@polaris/protocol";

/**
 * - supervised → `default`: prompt for anything not already allowed.
 * - auto-edits → `acceptEdits`: file edits in the working directories are auto-approved.
 * - auto → `auto`: Claude Code's own classifier approves or denies each prompt. It is the
 *   same idea as Polaris's "auto" (the Harness decides, the user is asked only when it can't).
 * - full-access → `bypassPermissions`: nothing prompts.
 */
export const toClaudePermissionMode = (mode: PermissionMode): ClaudePermissionMode => {
  switch (mode) {
    case "supervised":
      return "default";
    case "auto-edits":
      return "acceptEdits";
    case "auto":
      return "auto";
    case "full-access":
      return "bypassPermissions";
  }
};

const FILE_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

export const isQuestionTool = (toolName: string): boolean => toolName === "AskUserQuestion";

export const approvalKind = (toolName: string): ApprovalKind => {
  if (toolName === "Bash") return "command";
  if (FILE_TOOLS.has(toolName)) return "file-change";
  if (isQuestionTool(toolName)) return "question";
  return "tool";
};

export interface QuestionSpec {
  readonly question: string;
  readonly header: string;
  readonly options: ReadonlyArray<string>;
  readonly multiSelect: boolean;
}

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

const str = (u: unknown): string | null => (typeof u === "string" ? u : null);

/** The questions of an `AskUserQuestion` call (1–4, each with 2–4 options). */
export const parseQuestions = (input: unknown): ReadonlyArray<QuestionSpec> => {
  if (!isRecord(input) || !Array.isArray(input.questions)) return [];
  return input.questions.flatMap((q): QuestionSpec[] => {
    if (!isRecord(q)) return [];
    const question = str(q.question);
    if (question === null) return [];
    const options = Array.isArray(q.options)
      ? q.options.flatMap((o) => {
          const label = isRecord(o) ? str(o.label) : null;
          return label === null ? [] : [label];
        })
      : [];
    return [
      { question, header: str(q.header) ?? "", options, multiSelect: q.multiSelect === true },
    ];
  });
};

/** A one-line summary of a tool call, for approval cards and notifications. */
export const describeToolCall = (
  toolName: string,
  input: unknown
): { readonly title: string; readonly detail: string | null } => {
  const i = isRecord(input) ? input : {};
  switch (toolName) {
    case "Bash":
      return { title: str(i.description) ?? "Run a command", detail: str(i.command) };
    case "Edit":
    case "MultiEdit":
      return { title: "Edit a file", detail: str(i.file_path) };
    case "Write":
      return { title: "Write a file", detail: str(i.file_path) };
    case "NotebookEdit":
      return { title: "Edit a notebook", detail: str(i.notebook_path) };
    case "WebFetch":
      return { title: "Fetch a web page", detail: str(i.url) };
    case "WebSearch":
      return { title: "Search the web", detail: str(i.query) };
    case "ExitPlanMode":
      return { title: "Approve the plan", detail: str(i.plan) };
    case "AskUserQuestion": {
      const questions = parseQuestions(input);
      return {
        title: questions[0]?.question ?? "Claude has a question",
        detail: questions.length > 1 ? questions.map((q) => q.question).join("\n") : null,
      };
    }
    default:
      return { title: `Use ${toolName}`, detail: JSON.stringify(input) };
  }
};

/**
 * The `answers` map `AskUserQuestion` expects (question text → answer). One question takes
 * the whole text; several take one line each when the line count matches, else the whole text.
 */
export const answersFor = (
  questions: ReadonlyArray<QuestionSpec>,
  text: string
): Record<string, string> => {
  const lines = text.split("\n").map((l) => l.trim());
  const perLine = questions.length > 1 && lines.length === questions.length;
  return Object.fromEntries(questions.map((q, i) => [q.question, perLine ? lines[i]! : text]));
};

export const DEFAULT_DENY_MESSAGE = "The user declined this action.";

/** Turn a Client's decision into the SDK's `canUseTool` answer. */
export const toPermissionResult = (
  decision: ApprovalDecision,
  request: {
    readonly toolName: string;
    readonly input: Record<string, unknown>;
    readonly suggestions: ReadonlyArray<PermissionUpdate>;
  }
): PermissionResult => {
  switch (decision._tag) {
    case "Allow":
      return decision.remember && request.suggestions.length > 0
        ? {
            behavior: "allow",
            updatedInput: request.input,
            updatedPermissions: [...request.suggestions],
          }
        : { behavior: "allow", updatedInput: request.input };
    case "Deny":
      return { behavior: "deny", message: decision.reason ?? DEFAULT_DENY_MESSAGE };
    case "Answer":
      if (isQuestionTool(request.toolName)) {
        return {
          behavior: "allow",
          updatedInput: {
            ...request.input,
            answers: answersFor(parseQuestions(request.input), decision.text),
          },
        };
      }
      // A typed reply to a permission prompt: decline, and hand Claude the user's words.
      return { behavior: "deny", message: decision.text };
  }
};

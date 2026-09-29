/**
 * Polaris permission modes and approval decisions, mapped onto Claude Code's.
 */
import type {
  CanUseTool,
  PermissionMode as ClaudePermissionMode,
  PermissionResult,
  PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import { ApprovalDecision, type ApprovalKind, type PermissionMode } from "@polaris/protocol";
import { Option } from "effect";
import { decodeQuestions, present, type ToolPayload, toolFields } from "./payloads.ts";

/** A tool call's input as `canUseTool` receives it. */
export type ToolUseInput = Parameters<CanUseTool>[1];

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

/** The questions of an `AskUserQuestion` call (1–4, each with 2–4 options). */
export const parseQuestions = (input: ToolPayload): ReadonlyArray<QuestionSpec> =>
  Option.match(decodeQuestions(input), {
    onNone: () => [],
    onSome: ({ questions }) =>
      present(questions).map((q) => ({
        question: q.question,
        header: q.header ?? "",
        options: present(q.options).map((o) => o.label),
        multiSelect: q.multiSelect === true,
      })),
  });

/** A one-line summary of a tool call, for approval cards and notifications. */
export interface ToolDescription {
  readonly title: string;
  readonly detail: string | null;
}

export const describeToolCall = (toolName: string, input: ToolPayload): ToolDescription => {
  const i = toolFields(input);

  switch (toolName) {
    case "Bash":
      return { title: i.description ?? "Run a command", detail: i.command };
    case "Edit":
    case "MultiEdit":
      return { title: "Edit a file", detail: i.file_path };
    case "Write":
      return { title: "Write a file", detail: i.file_path };
    case "NotebookEdit":
      return { title: "Edit a notebook", detail: i.notebook_path };
    case "WebFetch":
      return { title: "Fetch a web page", detail: i.url };
    case "WebSearch":
      return { title: "Search the web", detail: i.query };
    case "ExitPlanMode":
      return { title: "Approve the plan", detail: i.plan };
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
    readonly input: ToolUseInput;
    readonly suggestions: ReadonlyArray<PermissionUpdate>;
  }
): PermissionResult =>
  ApprovalDecision.match(decision, {
    Allow: (allow): PermissionResult =>
      allow.remember && request.suggestions.length > 0
        ? {
            behavior: "allow",
            updatedInput: request.input,
            updatedPermissions: [...request.suggestions],
          }
        : { behavior: "allow", updatedInput: request.input },
    Deny: (deny): PermissionResult => ({
      behavior: "deny",
      message: deny.reason ?? DEFAULT_DENY_MESSAGE,
    }),
    Answer: (answer): PermissionResult =>
      isQuestionTool(request.toolName)
        ? {
            behavior: "allow",
            updatedInput: {
              ...request.input,
              answers: answersFor(parseQuestions(request.input), answer.text),
            },
          }
        : // A typed reply to a permission prompt: decline, and hand Claude the user's words.
          { behavior: "deny", message: answer.text },
  });

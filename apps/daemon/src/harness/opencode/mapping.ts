/**
 * Pure translations between Polaris and `opencode serve`: permission rulesets,
 * Model ids, parts → `TurnItem`s, approvals and prompts.
 */
import {
  ApprovalDecision,
  type ApprovalKind,
  type Attachment,
  Model,
  type ModelId,
  type PermissionMode,
  TurnItem,
} from "@polaris/protocol";
import { Match } from "effect";
import * as P from "./protocol.ts";

type Rule = P.PermissionRuleset[number];

const rule = (permission: string, action: Rule["action"]): Rule => ({
  permission,
  pattern: "*",
  action,
});

/** Tools that only read, or talk to the user: never asked about. */
const READ_ONLY = ["read", "glob", "grep", "list", "lsp", "todowrite", "todoread", "question"];

/**
 * The session ruleset for a mode. OpenCode applies the last matching rule and
 * `PATCH /session` appends, so each ruleset starts with a `*` rule that overrides every earlier one.
 */
export const rulesetFor = (mode: PermissionMode): P.PermissionRuleset =>
  Match.value(mode).pipe(
    Match.when("supervised", () => [
      rule("*", "ask"),
      ...READ_ONLY.map((name) => rule(name, "allow")),
    ]),
    Match.when("auto-edits", () => [
      rule("*", "ask"),
      ...READ_ONLY.map((name) => rule(name, "allow")),
      rule("edit", "allow"),
    ]),
    // OpenCode has no approval reviewer: work freely inside the Workspace, ask to leave it.
    Match.when("auto", () => [
      rule("*", "allow"),
      rule("external_directory", "ask"),
      rule("doom_loop", "ask"),
    ]),
    Match.when("full-access", () => [rule("*", "allow")]),
    Match.exhaustive
  );

/** `provider/model` → OpenCode's pair. The model part may itself contain `/` (OpenRouter). */
export const parseModelId = (id: ModelId): { providerID: string; modelID: string } | null => {
  const slash = id.indexOf("/");

  return slash <= 0 || slash === id.length - 1
    ? null
    : { providerID: id.slice(0, slash), modelID: id.slice(slash + 1) };
};

/**
 * The Models of every provider OpenCode can use on this Host, as `provider/model`.
 * A Model's effort levels are its `variants`; the default is OpenCode's configured
 * `model`, else the first provider's default.
 */
export const toModels = (
  response: P.ConfigProviders,
  configured: string | null
): ReadonlyArray<Model> => {
  const first = response.providers[0];

  const fallback =
    first === undefined || response.default[first.id] === undefined
      ? null
      : `${first.id}/${response.default[first.id]}`;

  const defaultId = configured ?? fallback;

  return response.providers.flatMap((provider) =>
    Object.values(provider.models)
      .filter((model) => model.status !== "deprecated")
      .map((model) => {
        const id = `${provider.id}/${model.id}`;

        return new Model({
          id,
          name: `${model.name} (${provider.name})`,
          description: null,
          efforts: Object.keys(model.variants ?? {}),
          defaultEffort: null,
          isDefault: id === defaultId,
        });
      })
  );
};

/** The body of a Turn's prompt: text, then an image part per image attachment. */
export const promptParts = (
  prompt: string,
  attachments: ReadonlyArray<Attachment>
): P.PromptAsyncBody["parts"] => {
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const others = attachments.filter((a) => !a.mimeType.startsWith("image/"));

  const text =
    others.length === 0
      ? prompt
      : `${prompt}\n\nAttached files:\n${others.map((a) => `- ${a.hostPath}`).join("\n")}`;

  return [
    { type: "text", text },
    ...images.map((a) => ({
      type: "file" as const,
      mime: a.mimeType,
      filename: a.name,
      url: Bun.pathToFileURL(a.hostPath).href,
    })),
  ];
};

/** OpenCode's placeholder titles; a real title replaces them once it has summarized the prompt. */
export const isPlaceholderTitle = (title: string): boolean =>
  /^(New session|Child session) - \d{4}-/.test(title);

const decodeBashInput = P.decoder(P.BashInput);

const decodeBashMetadata = P.decoder(P.BashMetadata);

const decodeFileInput = P.decoder(P.FileInput);

const decodeWriteMetadata = P.decoder(P.WriteMetadata);

const decodeTodoInput = P.decoder(P.TodoInput);

const decodePermissionMetadata = P.decoder(P.PermissionMetadata);

type ItemStatus = "running" | "completed" | "failed" | "declined";

const statusOf = (state: P.ToolState): ItemStatus =>
  Match.value(state).pipe(
    Match.when({ status: "error" }, (s) =>
      /rejected permission|dismissed this question/i.test(s.error) ? "declined" : "failed"
    ),
    Match.when({ status: "completed" }, () => "completed" as const),
    Match.orElse(() => "running" as const)
  );

const metadataOf = (state: P.ToolState): P.Payload =>
  "metadata" in state ? (state.metadata ?? {}) : {};

const PATCH_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;

const patchChanges = (patch: string) =>
  [...patch.matchAll(PATCH_HEADER)].map(([, verb, path]) => ({
    path: path?.trim() ?? "",
    kind: Match.value(verb).pipe(
      Match.when("Add", () => "add" as const),
      Match.when("Delete", () => "delete" as const),
      Match.orElse(() => "modify" as const)
    ),
  }));

const fileChanges = (part: P.ToolPart) => {
  const input = decodeFileInput(part.state.input) ?? {};

  if (input.patchText !== undefined) return patchChanges(input.patchText);

  if (input.filePath === undefined) return [];
  const existed = decodeWriteMetadata(metadataOf(part.state))?.exists === true;
  const created = part.tool === "write" && !existed;

  return [{ path: input.filePath, kind: created ? ("add" as const) : ("modify" as const) }];
};

const FILE_TOOLS = new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);

const commandItem = (part: P.ToolPart, cwd: string, status: ItemStatus): TurnItem => {
  const { state } = part;
  const input = decodeBashInput(state.input) ?? {};
  const metadata = decodeBashMetadata(metadataOf(state)) ?? {};

  const output = Match.value(state).pipe(
    Match.when({ status: "completed" }, (s) => s.output),
    Match.when({ status: "error" }, (s) => metadata.output || s.error),
    Match.orElse(() => metadata.output ?? "")
  );

  return TurnItem.cases.CommandExecution.make({
    id: part.id,
    command: input.command ?? "",
    cwd: input.workdir ?? cwd,
    output,
    exitCode: metadata.exit ?? null,
    status,
  });
};

/** A tool part as a `TurnItem`; null while it is still pending (its input isn't known yet). */
export const toolItem = (part: P.ToolPart, cwd: string): TurnItem | null => {
  const { state } = part;

  if (state.status === "pending") return null;
  const status = statusOf(state);

  if (part.tool === "bash") return commandItem(part, cwd, status);

  if (FILE_TOOLS.has(part.tool))
    return TurnItem.cases.FileChange.make({ id: part.id, changes: fileChanges(part), status });

  return TurnItem.cases.ToolCall.make({
    id: part.id,
    name: part.tool,
    input: state.input,
    output: Match.value(state).pipe(
      Match.when({ status: "completed" }, (s) => s.output),
      Match.when({ status: "error" }, (s) => s.error),
      Match.orElse(() => null)
    ),
    status,
  });
};

const planStatus = (status: string) =>
  Match.value(status).pipe(
    Match.when("in_progress", () => "in-progress" as const),
    Match.when("completed", () => "completed" as const),
    Match.orElse(() => "pending" as const)
  );

/** `todowrite`'s input as a Plan; null when it has no todo list. */
export const planItem = (id: string, input: P.Payload): TurnItem | null => {
  const todos = decodeTodoInput(input)?.todos;

  return todos === undefined
    ? null
    : TurnItem.cases.Plan.make({
        id,
        steps: todos.map((todo) => ({ text: todo.content, status: planStatus(todo.status) })),
      });
};

export interface ApprovalPrompt {
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly detail: string | null;
}

/** How a `permission.asked` request is shown. */
export const permissionPrompt = (request: P.PermissionRequest): ApprovalPrompt => {
  const patterns = request.patterns.join(", ");
  const metadata = decodePermissionMetadata(request.metadata) ?? {};

  return Match.value(request.permission).pipe(
    Match.when("bash", () => ({
      kind: "command" as const,
      title: metadata.command ?? patterns,
      detail: metadata.description ?? null,
    })),
    Match.when("edit", () => ({
      kind: "file-change" as const,
      title: `Edit ${metadata.filepath ?? patterns}`,
      detail: metadata.diff ?? null,
    })),
    Match.when("external_directory", () => ({
      kind: "tool" as const,
      title: `Access ${patterns} outside the Workspace`,
      detail: null,
    })),
    Match.orElse((permission) => ({
      kind: "tool" as const,
      title: patterns === "" || patterns === "*" ? permission : `${permission}: ${patterns}`,
      detail: null,
    }))
  );
};

/** Allow → once (always if remembered); Deny → reject; Answer → reject, with the text as guidance. */
export const permissionReply = (decision: ApprovalDecision): P.PermissionReplyBody =>
  ApprovalDecision.match(decision, {
    Allow: ({ remember }): P.PermissionReplyBody => ({ reply: remember ? "always" : "once" }),
    Deny: ({ reason }): P.PermissionReplyBody =>
      reason === null ? { reply: "reject" } : { reply: "reject", message: reason },
    Answer: ({ text }): P.PermissionReplyBody => ({ reply: "reject", message: text }),
  });

/** How a `question.asked` request is shown: its first question, with the others in the detail. */
export const questionPrompt = (
  request: P.QuestionRequest
): ApprovalPrompt & { readonly options: ReadonlyArray<string> } => {
  const [first, ...rest] = request.questions;

  return {
    kind: "question",
    title: first?.question ?? "OpenCode has a question",
    detail: rest.length === 0 ? null : rest.map((q) => q.question).join("\n"),
    options: first?.options.map((option) => option.label) ?? [],
  };
};

/** Answer → the text for every question; Allow → each question's first option; Deny → null (reject). */
export const questionReply = (
  request: P.QuestionRequest,
  decision: ApprovalDecision
): P.QuestionReplyBody | null =>
  ApprovalDecision.match(decision, {
    Allow: (): P.QuestionReplyBody | null => ({
      answers: request.questions.map((q) => (q.options[0] ? [q.options[0].label] : [])),
    }),
    Deny: () => null,
    Answer: ({ text }) => ({ answers: request.questions.map(() => [text]) }),
  });

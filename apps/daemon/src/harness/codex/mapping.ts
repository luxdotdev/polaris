/**
 * Pure translations between Polaris's Harness vocabulary and the Codex
 * app-server protocol. No I/O here, so every rule is unit-testable.
 */
import type { ApprovalDecision, Attachment, PermissionMode, TurnItem } from "@polaris/protocol"
import type * as Gen from "./generated/index.ts"
import type * as P from "./protocol.ts"

// ---------------------------------------------------------------------------
// Permission modes

export interface CodexPolicy {
  readonly approvalPolicy: Gen.AskForApproval
  readonly approvalsReviewer: Gen.ApprovalsReviewer
  /** For `thread/start` and `thread/resume`. */
  readonly sandbox: Gen.SandboxMode
}

/**
 * Polaris permission mode → Codex approval policy, reviewer and sandbox.
 *
 * | mode        | approvalPolicy | approvalsReviewer | sandbox            |
 * |-------------|----------------|-------------------|--------------------|
 * | supervised  | untrusted      | user              | read-only          |
 * | auto-edits  | on-request     | user              | workspace-write    |
 * | auto        | on-request     | auto_review       | workspace-write    |
 * | full-access | never          | user              | danger-full-access |
 *
 * Same table as T3 Code's runtime modes (design followed, no code copied).
 */
export const policyFor = (mode: PermissionMode): CodexPolicy => {
  switch (mode) {
    case "supervised":
      return { approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only" }
    case "auto-edits":
      return { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" }
    case "auto":
      return {
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        sandbox: "workspace-write",
      }
    case "full-access":
      return { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" }
  }
}

/** `turn/start` takes a full sandbox policy rather than a mode; this is the mode's default. */
export const sandboxPolicyFor = (mode: Gen.SandboxMode): Gen.SandboxPolicy => {
  switch (mode) {
    case "read-only":
      return { type: "readOnly", networkAccess: false }
    case "workspace-write":
      return {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      }
    case "danger-full-access":
      return { type: "dangerFullAccess" }
  }
}

// ---------------------------------------------------------------------------
// Turn input

/**
 * Images go to Codex as `localImage` inputs pointing at the staged Host path.
 * Other files are mentioned by path in the prompt, which Codex can read itself.
 */
export const turnInput = (
  prompt: string,
  attachments: ReadonlyArray<Attachment>,
): Array<Gen.UserInput> => {
  const images = attachments.filter((a) => a.mimeType.startsWith("image/"))
  const files = attachments.filter((a) => !a.mimeType.startsWith("image/"))
  const text =
    files.length === 0
      ? prompt
      : `${prompt}\n\nAttached files:\n${files.map((f) => `- ${f.hostPath}`).join("\n")}`
  return [
    { type: "text", text, text_elements: [] },
    ...images.map((image): Gen.UserInput => ({ type: "localImage", path: image.hostPath })),
  ]
}

// ---------------------------------------------------------------------------
// Items

const itemStatus = (
  status: "inProgress" | "completed" | "failed" | "declined",
): "running" | "completed" | "failed" | "declined" => (status === "inProgress" ? "running" : status)

/** Codex thread item → Polaris Turn item; null for items Polaris doesn't show (user messages…). */
export const toTurnItem = (item: P.ThreadItem): TurnItem | null => {
  switch (item.type) {
    case "agentMessage":
      if ("text" in item) return { _tag: "AssistantMessage", id: item.id, text: item.text }
      return null
    case "plan":
      if ("text" in item) return { _tag: "AssistantMessage", id: item.id, text: item.text }
      return null
    case "reasoning":
      if ("summary" in item) {
        const text = (item.summary.length > 0 ? item.summary : item.content).join("\n\n")
        return { _tag: "Reasoning", id: item.id, text }
      }
      return null
    case "commandExecution":
      if ("command" in item)
        return {
          _tag: "CommandExecution",
          id: item.id,
          command: item.command,
          cwd: item.cwd,
          output: item.aggregatedOutput ?? "",
          exitCode: item.exitCode,
          status: itemStatus(item.status),
        }
      return null
    case "fileChange":
      if ("changes" in item)
        return {
          _tag: "FileChange",
          id: item.id,
          changes: item.changes.map((change) => ({
            path: change.path,
            kind: change.kind.type === "update" ? "modify" : change.kind.type,
          })),
          status: itemStatus(item.status),
        }
      return null
    case "mcpToolCall":
      if ("server" in item)
        return {
          _tag: "ToolCall",
          id: item.id,
          name: `${item.server}.${item.tool}`,
          input: item.arguments,
          output: item.error ?? item.result,
          status: itemStatus(item.status),
        }
      return null
    case "dynamicToolCall":
      if ("contentItems" in item)
        return {
          _tag: "ToolCall",
          id: item.id,
          name: item.tool,
          input: item.arguments,
          output: item.contentItems,
          status: itemStatus(item.status),
        }
      return null
    case "collabAgentToolCall":
      if ("prompt" in item)
        return {
          _tag: "ToolCall",
          id: item.id,
          name: `agent.${item.tool}`,
          input: { prompt: item.prompt },
          output: null,
          status:
            item.status === "inProgress"
              ? "running"
              : item.status === "failed"
                ? "failed"
                : "completed",
        }
      return null
    case "webSearch":
      if ("query" in item)
        return {
          _tag: "ToolCall",
          id: item.id,
          name: "web_search",
          input: { query: item.query },
          output: null,
          status: "completed",
        }
      return null
    case "imageView":
      if ("path" in item)
        return {
          _tag: "ToolCall",
          id: item.id,
          name: "view_image",
          input: { path: item.path },
          output: null,
          status: "completed",
        }
      return null
    default:
      return null
  }
}

/** The text of a user message item (its text inputs, in order); null when it has none. */
export const userMessageText = (item: P.ThreadItem): string | null => {
  if (item.type !== "userMessage" || !("content" in item)) return null
  const text = item.content
    .flatMap((input) => (input.type === "text" && input.text !== undefined ? [input.text] : []))
    .join("\n")
  return text === "" ? null : text
}

export const toPlanItem = (
  id: string,
  plan: (typeof P.TurnPlanUpdatedNotification.Type)["plan"],
): TurnItem => ({
  _tag: "Plan",
  id,
  steps: plan.map((step) => ({
    text: step.step,
    status: step.status === "inProgress" ? "in-progress" : step.status,
  })),
})

// ---------------------------------------------------------------------------
// Approvals

/** Command and file-change approvals share one decision vocabulary. */
export const approvalDecision = (
  decision: ApprovalDecision,
): Gen.FileChangeRequestApprovalResponse => {
  switch (decision._tag) {
    case "Allow":
      return { decision: decision.remember ? "acceptForSession" : "accept" }
    case "Deny":
      return { decision: "decline" }
    case "Answer":
      return { decision: "decline" }
  }
}

export const permissionsDecision = (
  requested: (typeof P.PermissionsApprovalParams.Type)["permissions"],
  decision: ApprovalDecision,
): Gen.PermissionsRequestApprovalResponse => {
  if (decision._tag !== "Allow") return { permissions: {}, scope: "turn" }
  const granted: Record<string, unknown> = {}
  if (requested.network !== null) granted.network = requested.network
  if (requested.fileSystem !== null) granted.fileSystem = requested.fileSystem
  return {
    permissions: granted as Gen.PermissionsRequestApprovalResponse["permissions"],
    scope: decision.remember ? "session" : "turn",
  }
}

/**
 * A free-text answer fills every question; Allow picks each question's first
 * option; Deny answers nothing, which Codex treats as a dismissal.
 */
export const userInputDecision = (
  questions: (typeof P.UserInputParams.Type)["questions"],
  decision: ApprovalDecision,
): Gen.ToolRequestUserInputResponse => {
  const answers: Record<string, { answers: Array<string> }> = {}
  for (const question of questions) {
    if (decision._tag === "Answer") answers[question.id] = { answers: [decision.text] }
    else if (decision._tag === "Allow" && question.options?.[0])
      answers[question.id] = { answers: [question.options[0].label] }
  }
  return { answers }
}

export const elicitationDecision = (
  decision: ApprovalDecision,
): Gen.McpServerElicitationRequestResponse => {
  switch (decision._tag) {
    case "Allow":
      return { action: "accept", content: {}, _meta: null }
    case "Answer":
      return { action: "accept", content: { answer: decision.text }, _meta: null }
    case "Deny":
      return { action: "decline", content: null, _meta: null }
  }
}

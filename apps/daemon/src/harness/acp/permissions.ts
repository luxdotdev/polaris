/**
 * `session/request_permission` as Needs You: which requests Polaris answers by
 * the session's permission mode, how a request reads as an approval, and which
 * of the agent's options a decision picks.
 */
import { ApprovalDecision, type ApprovalKind, type PermissionMode } from "@polaris/protocol";
import * as P from "./protocol.ts";

/** Tool kinds each permission mode lets through without asking. */
const AUTO_ALLOWED: Record<PermissionMode, ReadonlySet<P.ToolKind>> = {
  supervised: new Set(["read", "search", "think"]),
  "auto-edits": new Set(["read", "search", "think", "edit", "move"]),
  auto: new Set(["read", "search", "think", "edit", "move", "execute", "fetch"]),
  "full-access": new Set([
    "read",
    "edit",
    "delete",
    "move",
    "search",
    "execute",
    "think",
    "fetch",
    "switch_mode",
    "other",
  ]),
};

/** Whether Polaris allows this tool call itself instead of asking. */
export const autoAllowed = (mode: PermissionMode, kind: P.ToolKind | null | undefined): boolean =>
  mode === "full-access" || (kind != null && AUTO_ALLOWED[mode].has(kind));

export const approvalKind = (kind: P.ToolKind | null | undefined): ApprovalKind => {
  if (kind === "execute") return "command";

  return kind === "edit" || kind === "delete" || kind === "move" ? "file-change" : "tool";
};

const MAX_DETAIL = 2_000;

/** One line for the approval, and what it would do. */
export interface ApprovalText {
  readonly title: string;
  readonly detail: string | null;
}

export const describe = (toolCall: P.ToolCallFields): ApprovalText => {
  const title = toolCall.title || toolCall.name || "Use a tool";
  const paths = (toolCall.content ?? []).flatMap((c) => (c.type === "diff" ? [c.path] : []));
  const locations = (toolCall.locations ?? []).map((l) => l.path);
  const shell = P.shellCommand(toolCall);

  if (shell !== null && shell !== title) return { title, detail: shell };

  if (paths.length > 0 || locations.length > 0)
    return { title, detail: [...new Set([...paths, ...locations])].join("\n") };

  if (toolCall.rawInput === undefined || toolCall.rawInput === null) return { title, detail: null };
  const raw = JSON.stringify(toolCall.rawInput) ?? "";

  return { title, detail: raw.length > MAX_DETAIL ? `${raw.slice(0, MAX_DETAIL)}…` : raw };
};

const selected = (option: P.PermissionOption | undefined): P.PermissionResponse =>
  option === undefined
    ? { outcome: { outcome: "cancelled" } }
    : { outcome: { outcome: "selected", optionId: option.optionId } };

const byKind = (
  options: ReadonlyArray<P.PermissionOption>,
  ...kinds: Array<P.PermissionOption["kind"]>
) => {
  for (const kind of kinds) {
    const found = options.find((option) => option.kind === kind);

    if (found !== undefined) return found;
  }

  return undefined;
};

/** Allows once, the way Polaris answers requests its permission mode lets through. */
export const allowOnce = (options: ReadonlyArray<P.PermissionOption>): P.PermissionResponse =>
  selected(byKind(options, "allow_once", "allow_always"));

/** The agent's option a decision picks; `cancelled` when it offered none that fits. */
export const permissionResponse = (
  options: ReadonlyArray<P.PermissionOption>,
  decision: ApprovalDecision
): P.PermissionResponse =>
  ApprovalDecision.match(decision, {
    Allow: ({ remember }) =>
      selected(
        remember
          ? byKind(options, "allow_always", "allow_once")
          : byKind(options, "allow_once", "allow_always")
      ),
    Deny: () => selected(byKind(options, "reject_once", "reject_always")),
    Answer: ({ text }) => {
      const wanted = text.trim().toLowerCase();

      return selected(
        options.find(
          (option) => option.name.toLowerCase() === wanted || option.optionId === text.trim()
        )
      );
    },
  });

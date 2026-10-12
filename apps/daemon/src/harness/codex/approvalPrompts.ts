/**
 * The server requests Codex asks Polaris to answer, as the approvals Polaris shows:
 * what each says, and how a decision answers it.
 */
import type { ApprovalDecision, ApprovalKind } from "@polaris/protocol";
import { Option, Schema } from "effect";
import {
  approvalDecision,
  elicitationDecision,
  permissionsDecision,
  userInputDecision,
} from "./mapping.ts";
import * as P from "./protocol.ts";

/** A server request Polaris shows as an approval, and how to answer it. */
export interface ApprovalPrompt {
  readonly kind: ApprovalKind;
  readonly title: string;
  readonly detail: string | null;
  readonly options: ReadonlyArray<string>;
  readonly respond: (decision: ApprovalDecision) => P.ServerRequestResponse;
}

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => {
  const decodeOption = Schema.decodeUnknownOption(schema);

  return (input: P.RpcPayload): S["Type"] | null => Option.getOrNull(decodeOption(input));
};

const decodeCommandApproval = decode(P.CommandApprovalParams);

const decodeFileApproval = decode(P.FileChangeApprovalParams);

const decodePermissions = decode(P.PermissionsApprovalParams);

const decodeUserInput = decode(P.UserInputParams);

const decodeElicitation = decode(P.ElicitationParams);

/** The approval shown for each server request Polaris answers; null when its params don't parse. */
export const approvalPrompts = new Map<
  string,
  (params: P.RpcPayload) => {
    readonly threadId: string;
    readonly turnId: string | null;
    readonly prompt: ApprovalPrompt;
  } | null
>([
  [
    "item/commandExecution/requestApproval",
    (params) => {
      const p = decodeCommandApproval(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "command",
              title: p.command ?? "Run a command",
              detail: p.reason ?? p.cwd ?? null,
              options: [],
              respond: approvalDecision,
            },
          };
    },
  ],
  [
    "item/fileChange/requestApproval",
    (params) => {
      const p = decodeFileApproval(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "file-change",
              title: p.grantRoot ? `Allow writes under ${p.grantRoot}` : "Apply file changes",
              detail: p.reason ?? null,
              options: [],
              respond: approvalDecision,
            },
          };
    },
  ],
  [
    "item/permissions/requestApproval",
    (params) => {
      const p = decodePermissions(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "tool",
              title: "Grant additional permissions",
              detail: [p.reason, JSON.stringify(p.permissions)].filter(Boolean).join("\n"),
              options: [],
              respond: (decision) => permissionsDecision(p.permissions, decision),
            },
          };
    },
  ],
  [
    "item/tool/requestUserInput",
    (params) => {
      const p = decodeUserInput(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "question",
              title: p.questions.map((q) => q.question).join("\n"),
              detail: p.questions.map((q) => q.header).join(" · ") || null,
              options: p.questions[0]?.options?.map((o) => o.label) ?? [],
              respond: (decision) => userInputDecision(p.questions, decision),
            },
          };
    },
  ],
  [
    "mcpServer/elicitation/request",
    (params) => {
      const p = decodeElicitation(params);

      return p === null
        ? null
        : {
            threadId: p.threadId,
            turnId: p.turnId,
            prompt: {
              kind: "tool",
              title: `${p.serverName}: ${p.message}`,
              detail: null,
              options: [],
              respond: elicitationDecision,
            },
          };
    },
  ],
]);

import {
  ConstellationCommand,
  TaskId,
  type ConstellationResult,
  type ConstellationRejected,
} from "@polaris/protocol";
import { Effect, Schema } from "effect";
import type { McpBinding } from "../binding.ts";
import type { toolFactory, BoundTool } from "./shared.ts";

const C = ConstellationCommand.cases;

export const workerTools = (
  bound: Extract<McpBinding, { _tag: "Worker" }>,
  define: ReturnType<typeof toolFactory>,
  submit: (
    command: ConstellationCommand
  ) => Effect.Effect<ConstellationResult, ConstellationRejected>,
  status: BoundTool
): ReadonlyArray<BoundTool> => [
  define(
    "progress",
    "Record a progress note and optional completed/total count in the UI.",
    Schema.Struct({
      note: C.WorkerProgress.fields.note,
      completed: C.WorkerProgress.fields.completed,
      total: C.WorkerProgress.fields.total,
    }),
    (input) =>
      submit(
        C.WorkerProgress.make({
          ...input,
          constellationId: bound.constellationId,
          attemptId: bound.attemptId,
        })
      ),
    {
      summary: "Progress recorded.",
      next: "Continue the assignment; report the next useful milestone.",
    }
  ),
  define(
    "ask",
    "Ask the Lead or user a question. Only the user grants approvals.",
    Schema.Struct({ question: C.WorkerAsk.fields.question }),
    (input) =>
      submit(
        C.WorkerAsk.make({
          ...input,
          constellationId: bound.constellationId,
          attemptId: bound.attemptId,
        })
      ),
    {
      summary: "Question recorded.",
      next: "Continue unblocked work; the answer arrives through Polaris.",
    }
  ),
  define(
    "claim",
    "Submit branch, head, commits, check receipts, unfinished work, follow-ups, questions, Area exceptions, decisions and summary.",
    Schema.Struct({ claim: C.WorkerClaim.fields.claim }),
    (input) =>
      submit(
        C.WorkerClaim.make({
          ...input,
          constellationId: bound.constellationId,
          attemptId: bound.attemptId,
        })
      ),
    {
      summary: "Claim recorded for review.",
      next: "Await the Lead’s review; a send-back creates a new Attempt.",
    }
  ),
  define(
    "propose",
    "Propose a new Task for the Lead to accept or decline.",
    Schema.Struct({ task: C.WorkerPropose.fields.task }),
    (input) =>
      submit(
        C.WorkerPropose.make({
          ...input,
          constellationId: bound.constellationId,
          attemptId: bound.attemptId,
        })
      ),
    {
      summary: "Proposal recorded.",
      next: "Continue the assigned Task; the Lead will review the proposal.",
    }
  ),
  define(
    "message",
    "Message a peer in this Constellation by its short Task id.",
    Schema.Struct({ to: TaskId, text: Schema.NonEmptyString }),
    (input) =>
      submit(
        C.WorkerMessage.make({
          ...input,
          constellationId: bound.constellationId,
          attemptId: bound.attemptId,
        })
      ),
    {
      summary: "Peer message queued.",
      next: "Continue the assignment; the peer receives a Polaris message.",
    }
  ),
  status,
];

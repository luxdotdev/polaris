import { AnswerAction, ReviewAction, WorkerPlacement } from "@polaris/protocol";
import { Schema } from "effect";

export const FriendlyWorker = Schema.Union([
  Schema.Struct({
    host: Schema.NonEmptyString,
    selection: WorkerPlacement.cases.New.fields.selection,
    base: WorkerPlacement.cases.New.fields.base,
    worktree: WorkerPlacement.cases.New.fields.worktree,
    branch: WorkerPlacement.cases.New.fields.branch,
  }),
  Schema.Struct({ session: Schema.NonEmptyString }),
]);

const R = ReviewAction.cases;

const A = AnswerAction.cases;

export const FriendlyReview = Schema.TaggedUnion({
  Accept: R.Accept.fields,
  SendBack: { ...R.SendBack.fields, worker: FriendlyWorker },
  Stop: R.Stop.fields,
  HandUp: R.HandUp.fields,
});

export const FriendlyAnswer = Schema.TaggedUnion({
  Proposal: A.Proposal.fields,
  Question: {
    task: Schema.NonEmptyString,
    questionId: A.Question.fields.questionId,
    text: A.Question.fields.text,
  },
});

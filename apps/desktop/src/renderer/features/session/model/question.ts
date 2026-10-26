import type { ApprovalDecision, ApprovalRequest } from "@polaris/protocol";
import type { QuestionStep } from "@polaris/ui";
import { Decisions } from "../../../commands.ts";

/**
 * A question's answers as the card numbers them. Harnesses mark their suggested
 * answer in the label ("Keep 20px (Recommended)"); that one is shown filled,
 * without the marker, and the Harness still gets its own words back.
 */
export interface QuestionAnswerView {
  readonly label: string;
  /** Sent back as the answer: the option exactly as the Harness offered it. */
  readonly value: string;
  readonly recommended: boolean;
}

const MARKER = /\s*\(recommended\)\s*$/i;

export const questionAnswers = (
  options: ReadonlyArray<string>
): ReadonlyArray<QuestionAnswerView> => {
  const first = options.findIndex((o) => MARKER.test(o));

  return options.map((value, n) => ({
    label: n === first ? value.replace(MARKER, "") : value,
    value,
    recommended: n === first,
  }));
};

/** One question as the card asks it; `values` are sent back for each answer. */
export interface QuestionView {
  readonly header: string | null;
  readonly question: string;
  readonly context: string | null;
  readonly answers: ReadonlyArray<QuestionAnswerView & { readonly description: string | null }>;
  readonly multiSelect: boolean;
}

const asOne = (request: ApprovalRequest): ReadonlyArray<QuestionView> => [
  {
    header: null,
    question: request.title,
    context: request.detail,
    answers: questionAnswers(request.options).map((a) => ({ ...a, description: null })),
    multiSelect: false,
  },
];

/**
 * Every question of a request. A Daemon before ENG-450 sends one, as the title and options;
 * when any question has nothing to pick, it is one too, answered in the composer.
 */
export const questionViews = (request: ApprovalRequest): ReadonlyArray<QuestionView> =>
  request.questions.length === 0 || request.questions.some((q) => q.options.length === 0)
    ? asOne(request)
    : request.questions.map((q) => {
        const views = questionAnswers(q.options.map((o) => o.label));

        return {
          header: q.header === "" ? null : q.header,
          question: q.question,
          context: null,
          answers: views.map((a, i) => ({ ...a, description: q.options[i]?.description ?? null })),
          multiSelect: q.multiSelect,
        };
      });

/**
 * The Answer for the card's picks: each question's chosen values, and as text one line per
 * question (labels joined with ", "), which a Daemon before ENG-450 reads instead.
 */
export const answerDecision = (
  views: ReadonlyArray<QuestionView>,
  picks: ReadonlyArray<ReadonlyArray<number>>
): ApprovalDecision => {
  const answers = views.map((view, i) =>
    (picks[i] ?? []).flatMap((n) => {
      const answer = view.answers[n];

      return answer === undefined ? [] : [answer.value];
    })
  );

  return Decisions.Answer({ text: answers.map((a) => a.join(", ")).join("\n"), answers });
};

/** The card's steps for these questions. */
export const questionSteps = (views: ReadonlyArray<QuestionView>): ReadonlyArray<QuestionStep> =>
  views.map((v) => ({
    header: v.header,
    question: v.question,
    context: v.context,
    answers: v.answers.map((a) => ({
      label: a.label,
      recommended: a.recommended,
      description: a.description,
    })),
    multiSelect: v.multiSelect,
  }));

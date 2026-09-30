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

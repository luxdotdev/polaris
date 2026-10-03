import { describe, expect, test } from "bun:test";
import { claimRefusal, type ClaimPlace } from "./refusal.ts";

const place: ClaimPlace = {
  taskId: "B1",
  branch: "polaris/c1/b1-quint-properties",
  head: "3f9c2e1aa0b1",
  leadBranch: "polaris/c1/lead",
};

const refused = (code: string, message: string, fix: string) => ({
  message: `${message}. ${fix}`,
  findings: [{ code, message, fix }],
});

/** The refusal the Desktop App used to show verbatim (attempts.ts's Accept, via worktrees). */
const NOT_MERGED = refused(
  "E-GIT",
  "The claimed head has not been merged into the Lead's branch",
  "Fetch the branch, check the working tree, and retry."
);

describe("claim refusals in the user's words", () => {
  test("an unmerged head names the merge and offers Approve", () => {
    expect(claimRefusal(NOT_MERGED, place)).toEqual({
      message:
        "Merge polaris/c1/b1-quint-properties at 3f9c2e1 into polaris/c1/lead first, or approve and let the lead merge.",
      offerApprove: true,
    });
  });

  test("without the Lead's checkout it still says what to do", () => {
    expect(claimRefusal(NOT_MERGED, { ...place, leadBranch: null }).message).toBe(
      "Merge polaris/c1/b1-quint-properties at 3f9c2e1 into the lead's branch first, or approve and let the lead merge."
    );
  });

  test("never shows the Daemon's agent-facing fix", () => {
    const cases = [
      NOT_MERGED,
      refused("E-GIT", "The claimed commit has not been fetched locally", "Fetch the branch."),
      refused("E-SOMETHING-NEW", "The worker Host is gone.", "Fetch the branch, check it."),
    ];

    for (const error of cases)
      expect(claimRefusal(error, place).message).not.toContain("Fetch the branch");
  });

  test("each Accept refusal gets its own next step", () => {
    const word = (code: string) => claimRefusal(refused(code, "x", "y"), place);

    expect(word("E-MERGED-HEAD")).toEqual({
      message: "Accept 3f9c2e1, the claimed head, or approve and let the lead merge.",
      offerApprove: true,
    });
    expect(word("E-RECEIPT-FAILED")).toEqual({
      message: "A receipt's check failed. Leave it out, or send B1 back.",
      offerApprove: false,
    });
    expect(word("E-RECEIPT-UNKNOWN").message).toBe(
      "A receipt doesn't match a recorded command. Leave it out, or send B1 back."
    );
    expect(word("E-REVISION").message).toBe(
      "B1's claim changed since you opened it. Read it again, then decide."
    );

    for (const code of ["E-SETTLED", "E-ATTEMPT-UNKNOWN", "E-REVIEW"])
      expect(word(code)).toEqual({
        message: "B1's claim is no longer in review.",
        offerApprove: false,
      });
  });

  test("a worded finding wins over an unknown one listed first", () => {
    const error = {
      message: "",
      findings: [
        { code: "E-OTHER", message: "Something else", fix: "Do a thing." },
        NOT_MERGED.findings[0]!,
      ],
    };

    expect(claimRefusal(error, place).offerApprove).toBe(true);
  });

  test("an unknown finding keeps its message only; a transport failure keeps its own", () => {
    expect(
      claimRefusal(refused("E-NEW", "The worker Host is gone", "Fetch the branch."), place)
    ).toEqual({ message: "The worker Host is gone.", offerApprove: false });
    expect(claimRefusal({ message: "Mac Studio is offline" }, place)).toEqual({
      message: "Mac Studio is offline",
      offerApprove: false,
    });
  });
});

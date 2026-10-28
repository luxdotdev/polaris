import { describe, expect, test } from "bun:test";
import { Command, type CommandId } from "@polaris/protocol";
import { Effect } from "effect";
import { askToFixCommand, ReviewRefused } from "./actions.ts";
import { finding } from "./review.testing.ts";
import {
  hostSubmissions,
  reviewSubmissions,
  type ReviewDispatch,
  reviewSlot,
} from "./submissions.ts";

type Answer = "ok" | "lost" | "refused";

/** A Host boundary whose replies the test releases one at a time. */
const heldHost = () => {
  const sent: Array<{ readonly command: Command; readonly id: CommandId }> = [];
  const pending: Array<(answer: Answer) => void> = [];

  const dispatch: ReviewDispatch = (command, id) =>
    Effect.flatMap(
      Effect.promise(
        () =>
          new Promise<Answer>((resolve) => {
            sent.push({ command, id });
            pending.push(resolve);
          })
      ),
      (answer) =>
        answer === "ok"
          ? Effect.void
          : Effect.fail(
              answer === "refused"
                ? new ReviewRefused("no such turn")
                : { message: "connection lost" }
            )
    );

  const answer = async (reply: Answer) => {
    await Promise.resolve();
    pending.shift()?.(reply);
  };

  return { sent, dispatch, answer };
};

const flagged = finding("f1", "critical");

const slot = reviewSlot.fix("s1", flagged.id);

const build = (commentId: string) => askToFixCommand("s1", flagged, "x()", commentId);

const commentIdOf = (command: Command) =>
  Command.guards.SendFeedback(command) ? command.feedback.comments[0]?.id : undefined;

describe("Review's submission slots", () => {
  test("a second Ask to fix before the first reply sends nothing more", async () => {
    const submissions = reviewSubmissions();
    const host = heldHost();
    const first = submissions.submit(slot, "x()", build, host.dispatch);
    const second = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("ok");

    expect(await Promise.all([first, second])).toEqual([null, null]);
    expect(host.sent).toHaveLength(1);
    expect(submissions.state(slot)).toEqual({ kind: "sent" });
  });

  test("a retry after a lost reply reuses the command and comment ids", async () => {
    const submissions = reviewSubmissions();
    const host = heldHost();
    const lost = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("lost");
    expect(await lost).toBe("connection lost");
    expect(submissions.state(slot)).toEqual({
      kind: "failed",
      message: "connection lost",
      refused: false,
    });

    const retry = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("ok");
    expect(await retry).toBeNull();

    const [before, after] = host.sent;

    expect(after?.id).toBe(before?.id);
    expect(commentIdOf(after!.command)).toBe(commentIdOf(before!.command));
  });

  test("a retry after a refusal is a new command", async () => {
    const submissions = reviewSubmissions();
    const host = heldHost();
    const refused = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("refused");
    expect(await refused).toBe("no such turn");

    const retry = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("ok");
    await retry;

    const [before, after] = host.sent;

    expect(after?.id).not.toBe(before?.id);
    expect(commentIdOf(after!.command)).not.toBe(commentIdOf(before!.command));
  });

  test("Ask to fix again after it was sent sends nothing more", async () => {
    const submissions = reviewSubmissions();
    const host = heldHost();
    const first = submissions.submit(slot, "x()", build, host.dispatch);

    await host.answer("ok");
    await first;

    expect(await submissions.submit(slot, "x()", build, host.dispatch)).toBeNull();
    expect(host.sent).toHaveLength(1);
  });
});

describe("slots shared across Review and the context pane", () => {
  test("Ask to fix in the pane, answer lost, retry from Review: the same command and comment ids", async () => {
    const slotsFor = hostSubmissions();
    const host = heldHost();
    const pane = slotsFor("h").submit(slot, "x()", build, host.dispatch);

    // Review opens (or the pane remounts) while the first Ask to fix is on its way.
    expect(slotsFor("h").state(slot)).toEqual({ kind: "sending" });
    await host.answer("lost");
    await pane;

    const review = slotsFor("h").submit(slot, "x()", build, host.dispatch);

    await host.answer("ok");
    expect(await review).toBeNull();

    const [before, after] = host.sent;

    expect(after?.id).toBe(before?.id);
    expect(commentIdOf(after!.command)).toBe(commentIdOf(before!.command));
    expect(slotsFor("other").state(slot)).toBeNull();
  });
});

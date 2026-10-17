import { describe, expect, test } from "bun:test";
import { BALL_SIZE, newPong, PADDLE, type PongState, stepPong, WINNING_SCORE } from "./pong.ts";
import { FIELD } from "./sprites.ts";

const still = { up: false, down: false };

const middle = () => 0.5;

/** A rally in progress: no serve wait, the ball where the test puts it. */
const rally = (
  ball: PongState["ball"],
  velocity: PongState["velocity"],
  extra: Partial<PongState> = {}
): PongState => ({ ...newPong(middle), serve: 0, ball, velocity, ...extra });

describe("the ball", () => {
  test("bounces off the top and bottom walls", () => {
    const top = stepPong(rally({ x: 70, y: 0.5 }, { x: 1, y: -1 }), still, middle);

    const bottom = stepPong(
      rally({ x: 70, y: FIELD.height - BALL_SIZE - 0.5 }, { x: 1, y: 1 }),
      still,
      middle
    );

    expect(top.velocity.y).toBeGreaterThan(0);
    expect(top.ball.y).toBeGreaterThanOrEqual(0);
    expect(bottom.velocity.y).toBeLessThan(0);
  });

  test("comes back off your paddle, a little faster, angled by where it hit", () => {
    const you = 40;
    const atFace = PADDLE.youX + PADDLE.width + 0.5;

    const centre = stepPong(
      rally({ x: atFace, y: you + 7 }, { x: -1.2, y: 0 }, { you }),
      still,
      middle
    );

    const edge = stepPong(
      rally({ x: atFace, y: you + 14 }, { x: -1.2, y: 0 }, { you }),
      still,
      middle
    );

    expect(centre.velocity.x).toBeGreaterThan(1.2);
    expect(Math.abs(centre.velocity.y)).toBeLessThan(0.1);
    expect(edge.velocity.y).toBeGreaterThan(0.5);
  });

  test("past your paddle scores for Polaris and serves toward you", () => {
    const after = stepPong(rally({ x: -1, y: 5 }, { x: -1.5, y: 0 }, { you: 60 }), still, middle);

    expect(after.score).toEqual({ you: 0, polaris: 1 });
    expect(after.velocity.x).toBeLessThan(0);
    expect(after.serve).toBeGreaterThan(0);
  });

  test("past Polaris scores for you", () => {
    const after = stepPong(
      rally({ x: FIELD.width - 1, y: 5 }, { x: 1.5, y: 0 }, { polaris: 70 }),
      still,
      middle
    );

    expect(after.score).toEqual({ you: 1, polaris: 0 });
  });
});

test("the match ends at the winning score", () => {
  const nearly = rally(
    { x: FIELD.width - 1, y: 5 },
    { x: 1.5, y: 0 },
    { polaris: 70, score: { you: WINNING_SCORE - 1, polaris: 3 } }
  );

  expect(stepPong(nearly, still, middle).status).toBe("over");
});

test("Polaris can't outrun a fast ball: it moves at a capped pace", () => {
  const start = rally({ x: 100, y: 90 }, { x: 2, y: 0 }, { polaris: 0 });
  const after = stepPong(start, still, middle);

  expect(after.polaris).toBeGreaterThan(0);
  expect(after.polaris).toBeLessThan(2);
});

test("your paddle stays on the field", () => {
  const top = stepPong(
    rally({ x: 70, y: 50 }, { x: 1, y: 0 }, { you: 0 }),
    { up: true, down: false },
    middle
  );

  expect(top.you).toBe(0);
});

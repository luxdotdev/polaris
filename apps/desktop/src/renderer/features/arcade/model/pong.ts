/**
 * Pong as a pure step on the 150×100 cell field, 60 ticks a second: you on the
 * left, Polaris on the right, first to 7. Where the ball meets a paddle sets its
 * angle, every return speeds it up, and Polaris tracks it at a beatable pace.
 */
import { FIELD } from "./sprites.ts";

import type { GameStatus } from "./game.ts";

export type PongStatus = GameStatus;

export interface PongState {
  readonly status: PongStatus;
  /** Paddle tops, in cells. */
  readonly you: number;
  readonly polaris: number;
  readonly ball: { readonly x: number; readonly y: number };
  readonly velocity: { readonly x: number; readonly y: number };
  readonly score: { readonly you: number; readonly polaris: number };
  /** Ticks until the next serve; the ball waits at the centre meanwhile. */
  readonly serve: number;
}

export interface PongControls {
  readonly up: boolean;
  readonly down: boolean;
}

export const WINNING_SCORE = 7;

export const PADDLE = { width: 2, height: 16, youX: 6, polarisX: 142 } as const;

export const BALL_SIZE = 2;

const PADDLE_SPEED = 1.6;

const POLARIS_SPEED = 0.95;

const SERVE_SPEED = 1.1;

const MAX_SPEED = 2.6;

const SPEED_UP = 1.06;

const SERVE_TICKS = 45;

const centred = (FIELD.height - PADDLE.height) / 2;

const served = (towards: 1 | -1, random: () => number) => ({
  ball: { x: (FIELD.width - BALL_SIZE) / 2, y: (FIELD.height - BALL_SIZE) / 2 },
  velocity: { x: SERVE_SPEED * towards, y: (random() - 0.5) * 1.2 },
  serve: SERVE_TICKS,
});

export const newPong = (random: () => number): PongState => ({
  status: "playing",
  you: centred,
  polaris: centred,
  score: { you: 0, polaris: 0 },
  ...served(-1, random),
});

const clampPaddle = (top: number) => Math.min(FIELD.height - PADDLE.height, Math.max(0, top));

const movePaddles = (state: PongState, controls: PongControls): PongState => {
  const you = clampPaddle(state.you + (Number(controls.down) - Number(controls.up)) * PADDLE_SPEED);
  // Polaris follows the ball only while it's coming, and no faster than POLARIS_SPEED.
  const target = state.velocity.x > 0 ? state.ball.y + BALL_SIZE / 2 - PADDLE.height / 2 : centred;
  const gap = target - state.polaris;

  const polaris = clampPaddle(
    state.polaris + Math.max(-POLARIS_SPEED, Math.min(POLARIS_SPEED, gap))
  );

  return { ...state, you, polaris };
};

/** The ball off a paddle: its angle from where it hit, a little faster each time. */
const returned = (state: PongState, paddleTop: number, towards: 1 | -1, x: number): PongState => {
  const offset =
    (state.ball.y + BALL_SIZE / 2 - (paddleTop + PADDLE.height / 2)) / (PADDLE.height / 2);

  const speed = Math.min(MAX_SPEED, Math.hypot(state.velocity.x, state.velocity.y) * SPEED_UP);
  const angle = Math.max(-1, Math.min(1, offset)) * (Math.PI / 3.5);

  return {
    ...state,
    ball: { ...state.ball, x },
    velocity: { x: Math.cos(angle) * speed * towards, y: Math.sin(angle) * speed },
  };
};

const meets = (ballY: number, paddleTop: number) =>
  ballY + BALL_SIZE > paddleTop && ballY < paddleTop + PADDLE.height;

const bounceWalls = (state: PongState): PongState => {
  const { ball, velocity } = state;

  if (ball.y < 0)
    return { ...state, ball: { ...ball, y: -ball.y }, velocity: { ...velocity, y: -velocity.y } };
  const floor = FIELD.height - BALL_SIZE;

  if (ball.y > floor) {
    return {
      ...state,
      ball: { ...ball, y: 2 * floor - ball.y },
      velocity: { ...velocity, y: -velocity.y },
    };
  }

  return state;
};

const hitPaddles = (state: PongState, previousX: number): PongState => {
  const { ball, velocity } = state;
  const yourFace = PADDLE.youX + PADDLE.width;

  if (velocity.x < 0 && previousX >= yourFace && ball.x < yourFace && meets(ball.y, state.you)) {
    return returned(state, state.you, 1, yourFace);
  }

  const theirFace = PADDLE.polarisX - BALL_SIZE;

  if (
    velocity.x > 0 &&
    previousX <= theirFace &&
    ball.x > theirFace &&
    meets(ball.y, state.polaris)
  ) {
    return returned(state, state.polaris, -1, theirFace);
  }

  return state;
};

/** A ball past a paddle scores for the other side and serves toward whoever lost the point. */
const scorePoint = (state: PongState, random: () => number): PongState => {
  const { x } = state.ball;

  if (x > -BALL_SIZE && x < FIELD.width) return state;
  const yours = x >= FIELD.width;

  const score = yours
    ? { ...state.score, you: state.score.you + 1 }
    : { ...state.score, polaris: state.score.polaris + 1 };

  const over = Math.max(score.you, score.polaris) >= WINNING_SCORE;

  return { ...state, score, status: over ? "over" : "playing", ...served(yours ? 1 : -1, random) };
};

export const stepPong = (
  state: PongState,
  controls: PongControls,
  random: () => number
): PongState => {
  if (state.status !== "playing") return state;
  const moved = movePaddles(state, controls);

  if (moved.serve > 0) return { ...moved, serve: moved.serve - 1 };
  const previousX = moved.ball.x;

  const flown = {
    ...moved,
    ball: { x: moved.ball.x + moved.velocity.x, y: moved.ball.y + moved.velocity.y },
  };

  return scorePoint(hitPaddles(bounceWalls(flown), previousX), random);
};

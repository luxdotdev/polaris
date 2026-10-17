import { describe, expect, test } from "bun:test";
import {
  COLS,
  INVADER_HEIGHT,
  type InvaderControls,
  type InvadersState,
  invaderAt,
  newInvaders,
  PLAYER_Y,
  ROWS,
  SHIELD_Y,
  stepInvaders,
} from "./invaders.ts";
import { FIELD } from "./sprites.ts";

const IDLE: InvaderControls = { left: false, right: false, fire: false };

const never = () => 0.5;

/** Steps with no bombs dropped: the tick lands between drops and marches. */
const step = (state: InvadersState, controls: InvaderControls = IDLE) =>
  stepInvaders({ ...state, tick: 1 }, controls, never);

const only = (index: number) => Array.from({ length: ROWS * COLS }, (_, i) => i === index);

describe("the fighter's shot", () => {
  test.each([
    [0, 30],
    [2, 20],
    [4, 10],
  ])("destroys the row-%p invader it reaches and scores %p", (row, points) => {
    const start = newInvaders();
    const target = invaderAt(start.formation, row, 3);
    const after = step({ ...start, shot: { x: target.x + 3, y: target.y + 4 } });

    expect(after.alive[row * COLS + 3]).toBe(false);
    expect(after.alive.filter(Boolean)).toHaveLength(ROWS * COLS - 1);
    expect(after.score).toBe(points);
    expect(after.shot).toBeNull();
  });

  test("is one at a time: fire while a shot is flying launches nothing", () => {
    const flying = { x: 10, y: 50 };
    const after = step({ ...newInvaders(), shot: flying }, { ...IDLE, fire: true });

    expect(after.shot).toEqual({ x: 10, y: 47 });
  });

  test("erodes the shield it hits and stops there", () => {
    const start = newInvaders();
    const x = 18 + 5;
    const before = start.shields[SHIELD_Y * FIELD.width + x];
    const after = step({ ...start, shot: { x, y: SHIELD_Y + 1 } });

    expect(before).toBe(1);
    expect(after.shot).toBeNull();
    expect(after.shields[(SHIELD_Y + 1) * FIELD.width + x]).toBe(0);
    // The previous state's shields are untouched.
    expect(start.shields[(SHIELD_Y + 1) * FIELD.width + x]).toBe(1);
  });
});

describe("the formation", () => {
  test("drops a step and turns back when it reaches the edge", () => {
    const start = newInvaders();
    const atEdge = { ...start, formation: { ...start.formation, x: 47 } };
    // Tick 0 is a marching tick for any formation size.
    const after = stepInvaders({ ...atEdge, tick: -1 }, IDLE, never);

    expect(after.formation.y).toBe(start.formation.y + 3);
    expect(after.formation.dx).toBe(-1);
    expect(after.formation.x).toBe(47);
  });

  test("reaching the fighter's row ends the game", () => {
    const start = newInvaders();

    const low = {
      ...start,
      formation: { ...start.formation, y: PLAYER_Y - 4 * 11 - INVADER_HEIGHT },
    };

    expect(step(low).status).toBe("over");
  });

  test("cleared, it brings the next wave", () => {
    const start = { ...newInvaders(), alive: only(0) };
    const target = invaderAt(start.formation, 0, 0);
    const after = step({ ...start, shot: { x: target.x + 3, y: target.y + 4 } });

    expect(after.wave).toBe(2);
    expect(after.alive.every(Boolean)).toBe(true);
    expect(after.status).toBe("playing");
  });
});

describe("bombs", () => {
  const onFighter = (state: InvadersState) => ({ x: state.playerX + 7, y: PLAYER_Y + 4 });

  test("a hit costs a life and clears the bombs", () => {
    const start = newInvaders();
    const after = step({ ...start, bombs: [onFighter(start)] });

    expect(after.lives).toBe(2);
    expect(after.bombs).toEqual([]);
    expect(after.status).toBe("playing");
  });

  test("a fighter just hit can't be hit again", () => {
    const start = { ...newInvaders(), respawn: 30 };

    expect(step({ ...start, bombs: [onFighter(start)] }).lives).toBe(3);
  });

  test("the last life lost ends the game", () => {
    const start = { ...newInvaders(), lives: 1 };

    expect(step({ ...start, bombs: [onFighter(start)] }).status).toBe("over");
  });
});

test("a paused or finished game doesn't move", () => {
  const paused = { ...newInvaders(), status: "paused" as const };

  expect(stepInvaders(paused, { ...IDLE, right: true }, never)).toBe(paused);
});

/**
 * Space Invaders as a pure step on the 150×100 cell field, 60 ticks a second:
 * the fighter moves and fires one shot at a time, the formation marches and
 * drops at the edges, bombs fall, and shields erode where anything hits them.
 */
import { FIELD, INVADERS, SHIELD, SHIP, litCells, spriteWidth } from "./sprites.ts";

import type { GameStatus } from "./game.ts";

export type Status = GameStatus;

export interface Shot {
  readonly x: number;
  readonly y: number;
}

export interface Formation {
  readonly x: number;
  readonly y: number;
  readonly dx: 1 | -1;
  readonly frame: 0 | 1;
}

export interface InvadersState {
  readonly status: Status;
  readonly tick: number;
  readonly score: number;
  readonly lives: number;
  readonly wave: number;
  readonly playerX: number;
  /** Ticks left in which a hit fighter can't be hit again. */
  readonly respawn: number;
  readonly shot: Shot | null;
  readonly bombs: ReadonlyArray<Shot>;
  /** Row-major, ROWS × COLS. */
  readonly alive: ReadonlyArray<boolean>;
  readonly formation: Formation;
  /** One byte per field cell, row-major; never written after the step that made it. */
  readonly shields: Uint8Array;
}

export interface InvaderControls {
  readonly left: boolean;
  readonly right: boolean;
  readonly fire: boolean;
}

export const COLS = 8;

export const ROWS = 5;

const SLOT_X = 14;

const SLOT_Y = 11;

const SLOT_WIDTH = 12;

export const INVADER_HEIGHT = 8;
/** Which of the three invaders each row is, and what it scores. */

export const ROW_KIND = [0, 1, 1, 2, 2] as const;

const POINTS = [30, 20, 20, 10, 10] as const;

export const PLAYER_Y = 85;

const SHIP_WIDTH = spriteWidth(SHIP);

const SHIP_HEIGHT = SHIP.length;

export const SHIELD_Y = 72;

export const GROUND_Y = 97;

const EDGE = 2;

const SHOT_LENGTH = 3;

const SHOT_SPEED = 3;

const RESPAWN_TICKS = 90;

const kindOf = (row: number) => ROW_KIND[row] ?? 0;

export const invaderSprite = (row: number, frame: 0 | 1) => INVADERS[kindOf(row)]?.[frame] ?? [];

/** An invader's top-left cell: centred in its 12-cell slot. */
export const invaderAt = (formation: Formation, row: number, col: number) => {
  const width = spriteWidth(invaderSprite(row, 0));

  return {
    x: formation.x + col * SLOT_X + Math.floor((SLOT_WIDTH - width) / 2),
    y: formation.y + row * SLOT_Y,
    width,
  };
};

const freshShields = () => {
  const shields = new Uint8Array(FIELD.width * FIELD.height);

  for (let k = 0; k < 4; k += 1) {
    for (const [x, y] of litCells(SHIELD))
      shields[(SHIELD_Y + y) * FIELD.width + 18 + k * 34 + x] = 1;
  }

  return shields;
};

const startFormation = (wave: number): Formation => ({
  x: 22,
  y: 12 + Math.min(wave - 1, 4) * 4,
  dx: 1,
  frame: 0,
});

export const newInvaders = (): InvadersState => ({
  status: "playing",
  tick: 0,
  score: 0,
  lives: 3,
  wave: 1,
  playerX: Math.floor((FIELD.width - SHIP_WIDTH) / 2),
  respawn: 0,
  shot: null,
  bombs: [],
  alive: Array.from({ length: ROWS * COLS }, () => true),
  formation: startFormation(1),
  shields: freshShields(),
});

const aliveCells = (state: InvadersState) =>
  state.alive.flatMap((alive, i) =>
    alive ? [{ row: Math.floor(i / COLS), col: i % COLS, i }] : []
  );

/** Ticks between marching steps: faster as the formation thins, and wave by wave. */
const marchEvery = (alive: number, wave: number) =>
  Math.max(2, Math.ceil(alive / 2) - Math.min(wave - 1, 3));

const march = (state: InvadersState): Formation => {
  const { formation } = state;
  const boxes = aliveCells(state).map(({ row, col }) => invaderAt(formation, row, col));
  const left = Math.min(...boxes.map((b) => b.x)) + formation.dx;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + formation.dx;
  const frame = formation.frame === 0 ? 1 : 0;

  if (left < EDGE || right > FIELD.width - EDGE) {
    return { ...formation, y: formation.y + 3, dx: formation.dx === 1 ? -1 : 1, frame };
  }

  return { ...formation, x: formation.x + formation.dx, frame };
};

const shotCells = (shot: Shot) =>
  Array.from({ length: SHOT_LENGTH }, (_, k) => [shot.x, Math.floor(shot.y) + k] as const);

/** A shield cell under the shot, if any. */
const shieldHit = (shields: Uint8Array, shot: Shot) =>
  shotCells(shot).find(([x, y]) => shields[y * FIELD.width + x] === 1) ?? null;

/** Clears a small blast around a hit: the cell, its four neighbours and two more along the shot. */
const erode = (shields: Uint8Array, [x, y]: readonly [number, number]) => {
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0, 2],
    [0, -2],
  ] as const) {
    const cx = x + dx;
    const cy = y + dy;

    if (cx >= 0 && cx < FIELD.width && cy >= 0 && cy < FIELD.height)
      shields[cy * FIELD.width + cx] = 0;
  }
};

const inBox = (box: { x: number; y: number; width: number; height: number }, shot: Shot) =>
  shotCells(shot).some(
    ([x, y]) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
  );

const moveFighter = (state: InvadersState, controls: InvaderControls): InvadersState => {
  const step = Number(controls.right) - Number(controls.left);
  const playerX = Math.min(FIELD.width - EDGE - SHIP_WIDTH, Math.max(EDGE, state.playerX + step));
  const moved = state.shot === null ? null : { ...state.shot, y: state.shot.y - SHOT_SPEED };
  const kept = moved === null || moved.y < 0 ? null : moved;

  const shot =
    kept === null && controls.fire
      ? { x: playerX + Math.floor(SHIP_WIDTH / 2), y: PLAYER_Y - SHOT_LENGTH }
      : kept;

  return { ...state, playerX, shot, respawn: Math.max(0, state.respawn - 1) };
};

const moveInvaders = (state: InvadersState, random: () => number): InvadersState => {
  const alive = aliveCells(state);
  const marched = state.tick % marchEvery(alive.length, state.wave) === 0;
  const formation = marched ? march(state) : state.formation;
  const fallen = state.bombs.map((b) => ({ ...b, y: b.y + 1 })).filter((b) => b.y < GROUND_Y);
  const dropEvery = Math.max(20, 50 - state.wave * 5);

  if (state.tick % dropEvery !== 0 || fallen.length >= 3 + Math.floor(state.wave / 2)) {
    return { ...state, formation, bombs: fallen };
  }

  // A random column's lowest invader drops the bomb.
  const columns = [...new Set(alive.map((a) => a.col))];
  const col = columns[Math.floor(random() * columns.length)];
  const lowest = alive.filter((a) => a.col === col).at(-1);

  if (lowest === undefined) return { ...state, formation, bombs: fallen };
  const box = invaderAt(formation, lowest.row, lowest.col);
  const bomb = { x: box.x + Math.floor(box.width / 2), y: box.y + INVADER_HEIGHT };

  return { ...state, formation, bombs: [...fallen, bomb] };
};

/** The fighter's shot against invaders, bombs and shields, in that order. */
const resolveShot = (state: InvadersState, shields: Uint8Array): InvadersState => {
  const { shot } = state;

  if (shot === null) return state;

  const hit = aliveCells(state).find(({ row, col }) =>
    inBox({ ...invaderAt(state.formation, row, col), height: INVADER_HEIGHT }, shot)
  );

  if (hit !== undefined) {
    const alive = state.alive.map((a, i) => a && i !== hit.i);

    return { ...state, alive, shot: null, score: state.score + (POINTS[hit.row] ?? 0) };
  }

  const bomb = state.bombs.find((b) => b.x === shot.x && Math.abs(b.y - shot.y) < SHOT_LENGTH + 1);

  if (bomb !== undefined)
    return { ...state, shot: null, bombs: state.bombs.filter((b) => b !== bomb) };
  const cell = shieldHit(shields, shot);

  if (cell === null) return state;
  erode(shields, cell);

  return { ...state, shot: null };
};

/** Bombs against shields and the fighter; invaders scrape away the shields they reach. */
const resolveBombs = (state: InvadersState, shields: Uint8Array): InvadersState => {
  const bombs = state.bombs.filter((bomb) => {
    const cell = shieldHit(shields, bomb);

    if (cell !== null) erode(shields, cell);

    return cell === null;
  });

  for (const { row, col } of aliveCells(state)) {
    const box = invaderAt(state.formation, row, col);

    for (let y = box.y; y < box.y + INVADER_HEIGHT; y += 1) {
      shields.fill(0, y * FIELD.width + box.x, y * FIELD.width + box.x + box.width);
    }
  }

  const fighter = { x: state.playerX, y: PLAYER_Y, width: SHIP_WIDTH, height: SHIP_HEIGHT };

  if (state.respawn > 0 || !bombs.some((b) => inBox(fighter, b))) return { ...state, bombs };
  const lives = state.lives - 1;

  return {
    ...state,
    bombs: [],
    lives,
    respawn: RESPAWN_TICKS,
    status: lives === 0 ? "over" : "playing",
  };
};

/** A cleared wave brings the next, one step lower; the formation reaching the fighter ends the game. */
const resolveWave = (state: InvadersState): InvadersState => {
  const alive = aliveCells(state);

  if (alive.length === 0) {
    const wave = state.wave + 1;

    return {
      ...state,
      wave,
      alive: state.alive.map(() => true),
      formation: startFormation(wave),
      shot: null,
      bombs: [],
      shields: freshShields(),
    };
  }

  const lowest = Math.max(...alive.map(({ row }) => row));
  const bottom = state.formation.y + lowest * SLOT_Y + INVADER_HEIGHT;

  return bottom >= PLAYER_Y ? { ...state, status: "over" } : state;
};

export const stepInvaders = (
  state: InvadersState,
  controls: InvaderControls,
  random: () => number
): InvadersState => {
  if (state.status !== "playing") return state;
  const shields = state.shields.slice();
  const moved = moveInvaders(moveFighter({ ...state, tick: state.tick + 1 }, controls), random);
  const resolved = resolveBombs(resolveShot(moved, shields), shields);

  return resolveWave({ ...resolved, shields });
};

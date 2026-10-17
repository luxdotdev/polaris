/**
 * Drawing a game onto its 150×100 canvas, one canvas pixel to a cell; CSS scales
 * it 4× with `image-rendering: pixelated`, so every cell stays a crisp square.
 */
import {
  COLS,
  GROUND_Y,
  type InvadersState,
  PLAYER_Y,
  SHIELD_Y,
  invaderAt,
  invaderSprite,
} from "../model/invaders.ts";
import { BALL_SIZE, PADDLE, type PongState } from "../model/pong.ts";
import { DIGITS, FIELD, SHIELD, SHIP, type Sprite } from "../model/sprites.ts";
import type { FieldColours } from "./loop.ts";

const sprite = (g: CanvasRenderingContext2D, bitmap: Sprite, x: number, y: number, scale = 1) => {
  bitmap.forEach((row, cy) => {
    for (let cx = 0; cx < row.length; cx += 1) {
      if (row[cx] === "#") g.fillRect(x + cx * scale, y + cy * scale, scale, scale);
    }
  });
};

/** A fixed scatter of faint stars (transparent in light), the same every frame. */
const STARS = Array.from({ length: 26 }, (_, i) => ({
  x: (i * 53 + 17) % FIELD.width,
  y: (i * 37 + 11) % (FIELD.height - 20),
}));

const stars = (g: CanvasRenderingContext2D, colours: FieldColours) => {
  g.fillStyle = colours.star;

  for (const star of STARS) g.fillRect(star.x, star.y, 1, 1);
};

const shields = (g: CanvasRenderingContext2D, cells: Uint8Array) => {
  for (let y = SHIELD_Y; y < SHIELD_Y + SHIELD.length; y += 1) {
    for (let x = 0; x < FIELD.width; x += 1) {
      if (cells[y * FIELD.width + x] === 1) g.fillRect(x, y, 1, 1);
    }
  }
};

export const drawInvaders = (
  g: CanvasRenderingContext2D,
  state: InvadersState,
  colours: FieldColours
) => {
  g.clearRect(0, 0, FIELD.width, FIELD.height);
  stars(g, colours);
  g.fillStyle = colours.ink;

  state.alive.forEach((alive, i) => {
    if (!alive) return;
    const row = Math.floor(i / COLS);
    const at = invaderAt(state.formation, row, i % COLS);

    sprite(g, invaderSprite(row, state.formation.frame), at.x, at.y);
  });

  g.fillStyle = colours.faint;
  shields(g, state.shields);
  g.fillStyle = colours.ink;
  // A hit fighter blinks while it can't be hit again.

  if (state.respawn === 0 || Math.floor(state.respawn / 6) % 2 === 0) {
    sprite(g, SHIP, state.playerX, PLAYER_Y);
  }

  if (state.shot !== null) g.fillRect(state.shot.x, Math.floor(state.shot.y), 1, 3);
  g.fillStyle = colours.subtle;

  for (const bomb of state.bombs) {
    const y = Math.floor(bomb.y);
    const zig = Math.floor(y / 2) % 2;

    g.fillRect(bomb.x + zig, y, 1, 1);
    g.fillRect(bomb.x + 1 - zig, y + 1, 1, 1);
    g.fillRect(bomb.x + zig, y + 2, 1, 1);
  }

  g.fillStyle = colours.ground;
  g.fillRect(0, GROUND_Y, FIELD.width, 1);
};

const score = (g: CanvasRenderingContext2D, value: number, x: number) => {
  const digits = String(value);

  digits.split("").forEach((d, k) => sprite(g, DIGITS[Number(d)] ?? [], x + k * 12, 8, 3));
};

export const drawPong = (g: CanvasRenderingContext2D, state: PongState, colours: FieldColours) => {
  g.clearRect(0, 0, FIELD.width, FIELD.height);
  g.fillStyle = colours.ground;

  for (let y = 2; y < FIELD.height - 2; y += 6) g.fillRect(74, y, 2, 3);
  g.fillStyle = colours.subtle;
  score(g, state.score.you, 54);
  score(g, state.score.polaris, 87);
  g.fillStyle = colours.ink;
  g.fillRect(PADDLE.youX, Math.round(state.you), PADDLE.width, PADDLE.height);
  g.fillRect(PADDLE.polarisX, Math.round(state.polaris), PADDLE.width, PADDLE.height);

  // The ball blinks in the centre while it waits to be served.
  if (state.serve === 0 || Math.floor(state.serve / 8) % 2 === 0) {
    g.fillRect(Math.round(state.ball.x), Math.round(state.ball.y), BALL_SIZE, BALL_SIZE);
  }
};

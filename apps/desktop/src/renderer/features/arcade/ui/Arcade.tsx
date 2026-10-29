/**
 * The arcade card (Paper G2, G3): the Command Palette's 620px card over the same
 * scrim, a header with the game's name and score, a 600×400 pixel playfield, and
 * the palette's key-hint footer. Esc closes it, back to work.
 */
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@polaris/ui";
import { type ReactNode, useId } from "react";
import { useStore } from "zustand";
import { type GameStatus, togglePause } from "../model/game.ts";
import { type InvadersState, newInvaders, stepInvaders } from "../model/invaders.ts";
import { newPong, type PongState, stepPong, WINNING_SCORE } from "../model/pong.ts";
import { FIELD, litCells, SHIP, spriteWidth } from "../model/sprites.ts";
import { arcadeStore, closeGame } from "../store.ts";
import { drawInvaders, drawPong } from "./draw.ts";
import { FIELD_COLOURS, FIELD_GROUND, type GameHandle, type GameSpec, useGame } from "./loop.ts";

const INVADERS: GameSpec<InvadersState> = {
  start: newInvaders,
  step: (state, held) =>
    stepInvaders(
      state,
      { left: held.has("left"), right: held.has("right"), fire: held.has("fire") },
      Math.random
    ),
  draw: drawInvaders,
  togglePause,
};

const PONG: GameSpec<PongState> = {
  start: () => newPong(Math.random),
  step: (state, held) =>
    stepPong(state, { up: held.has("up"), down: held.has("down") }, Math.random),
  draw: drawPong,
  togglePause,
};

const invadersShown = (s: InvadersState) => `${s.status} ${s.score} ${s.lives} ${s.wave}`;

const pongShown = (s: PongState) => `${s.status} ${s.score.you} ${s.score.polaris}`;

/** A life: the fighter at one pixel a cell, in `text-subtle`. */
const Life = () => (
  <svg
    aria-hidden
    width={spriteWidth(SHIP)}
    height={SHIP.length}
    viewBox={`0 0 ${spriteWidth(SHIP)} ${SHIP.length}`}
    className="text-text-subtle fill-current [shape-rendering:crispEdges]"
  >
    {litCells(SHIP).map(([x, y]) => (
      <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} />
    ))}
  </svg>
);

interface Message {
  readonly title: string;
  readonly detail: string;
}

interface CardProps<S> {
  readonly game: GameHandle<S>;
  readonly label: string;
  readonly header: ReactNode;
  readonly message: Message | null;
  readonly hints: ReadonlyArray<string>;
}

const Card = <S,>({ game, label, header, message, hints }: CardProps<S>) => (
  <>
    <div className="border-hairline h-session-row px-panel gap-row-x flex shrink-0 items-center border-b">
      {header}
    </div>
    <div className="p-gap">
      <div
        className="rounded-control relative overflow-hidden"
        style={{ backgroundColor: FIELD_GROUND }}
      >
        <canvas
          ref={game.canvas}
          width={FIELD.width}
          height={FIELD.height}
          role="img"
          aria-label={label}
          className="block h-[400px] w-[600px] [image-rendering:pixelated]"
        />
        {message === null ? null : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              role="status"
              className="bg-surface-raised border-hairline rounded-row px-panel py-gap flex flex-col items-center gap-0.5 border"
            >
              <span className="text-heading-sm text-text-strong font-medium">{message.title}</span>
              <span className="text-caption text-text-subtle">{message.detail}</span>
            </div>
          </div>
        )}
      </div>
    </div>
    <div className="border-hairline gap-panel px-panel text-caption text-text-subtle flex h-9 shrink-0 items-center border-t">
      {hints.map((hint) => (
        <span key={hint}>{hint}</span>
      ))}
      <span className="flex-1" />
      <span>esc back to work</span>
    </div>
    <div ref={game.swatches} aria-hidden className="hidden">
      {Object.entries(FIELD_COLOURS).map(([key, color]) => (
        <span key={key} data-swatch={key} style={{ color }} />
      ))}
    </div>
  </>
);

const PAUSED: Message = { title: "Paused", detail: "p to resume" };

const messageFor = (status: GameStatus, over: Message): Message | null =>
  ({ playing: null, paused: PAUSED, over })[status];

const Title = ({ name, detail }: { readonly name: string; readonly detail: string }) => (
  <>
    <span className="text-heading-sm text-text-strong font-medium">{name}</span>
    <span className="text-caption text-text-subtle">{detail}</span>
    <span className="flex-1" />
  </>
);

const InvadersGame = () => {
  const game = useGame(INVADERS, invadersShown);
  const { state } = game;

  return (
    <Card
      game={game}
      label="Space Invaders playfield"
      header={
        <>
          <Title name="Space Invaders" detail={`Wave ${state.wave}`} />
          <span
            className="flex items-center gap-1.5 pr-1.5"
            aria-label={`${state.lives} lives left`}
          >
            {Array.from({ length: Math.max(0, state.lives - 1) }, (_, i) => (
              <Life key={i} />
            ))}
          </span>
          <span className="text-body text-text-default font-mono tabular-nums">
            {String(state.score).padStart(5, "0")}
          </span>
        </>
      }
      message={messageFor(state.status, {
        title: "Game over",
        detail: `Score ${state.score} · ↵ play again`,
      })}
      hints={["←→ move", "space fire", "p pause"]}
    />
  );
};

const PongGame = () => {
  const game = useGame(PONG, pongShown);
  const { score, status } = game.state;
  const won = score.you > score.polaris;

  return (
    <Card
      game={game}
      label="Pong playfield"
      header={<Title name="Pong" detail={`You against Polaris · first to ${WINNING_SCORE}`} />}
      message={messageFor(status, {
        title: won ? "You win" : "Polaris wins",
        detail: `${score.you}–${score.polaris} · ↵ play again`,
      })}
      hints={["↑↓ move", "p pause"]}
    />
  );
};

const TITLES = { invaders: "Space Invaders", pong: "Pong" } as const;

/** Rendered only while a game is open, like the palette, so no closing layer takes the next Escape. */
export const Arcade = () => {
  const game = useStore(arcadeStore, (s) => s.game);
  const description = useId();

  if (game === null) return null;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : closeGame())}>
      <DialogContent
        placement="top"
        className="w-[620px]"
        aria-describedby={description}
        data-testid="arcade"
      >
        <DialogTitle className="sr-only">{TITLES[game]}</DialogTitle>
        <DialogDescription id={description} className="sr-only">
          A game. Esc closes it.
        </DialogDescription>
        {game === "invaders" ? <InvadersGame /> : <PongGame />}
      </DialogContent>
    </Dialog>
  );
};

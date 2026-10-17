/** What both games share: which one is open, and pausing. */

export type GameKind = "invaders" | "pong";

export type GameStatus = "playing" | "paused" | "over";

const PAUSED = { playing: "paused", paused: "playing", over: "over" } as const satisfies Record<
  GameStatus,
  GameStatus
>;

/** P pauses a game in play and resumes a paused one; a finished game stays finished. */
export const togglePause = <S extends { readonly status: GameStatus }>(state: S): S => ({
  ...state,
  status: PAUSED[state.status],
});

/**
 * Picks a new session's Celestial (CONTEXT.md). Pure, so the fold can give the same planet to a
 * session logged before Celestials. See docs/adr/0085-a-session-s-celestial-is-assigned-at-creation.md.
 */
import {
  type AgentSession,
  CELESTIAL_PLANETS,
  CELESTIAL_RARE,
  type CelestialBody,
} from "@polaris/protocol";

/** FNV-1a over the session id: where its search through the planets starts. */
const seed = (id: string): number => {
  let hash = 0x81_1c_9d_c5;

  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93);
  }

  return hash >>> 0;
};

/** How many active sessions in the Workspace already show each planet. */
const planetsInUse = (
  sessions: Iterable<{ readonly session: AgentSession }>,
  session: Pick<AgentSession, "id" | "workspaceId">
): Map<CelestialBody, number> => {
  const uses = new Map<CelestialBody, number>();

  for (const { session: other } of sessions) {
    if (other.id === session.id || other.workspaceId !== session.workspaceId) continue;

    if (other.state === "archived" || other.celestial == null) continue;
    uses.set(other.celestial, (uses.get(other.celestial) ?? 0) + 1);
  }

  return uses;
};

/** One new session in this many gets the Death Star in place of a planet. */
export const DEATH_STAR_ODDS = 100;

/** The session id's roll for the Death Star, hashed apart from its planet's place. */
const rollsDeathStar = (id: string) => seed(`death-star:${id}`) % DEATH_STAR_ODDS === 0;

/**
 * A planet no active session in the Workspace shows, searched from a place set by the session's
 * id; when every planet is taken, the least shared one. A lucky id gets the Death Star if it's free.
 */
export const pickCelestial = (
  sessions: Iterable<{ readonly session: AgentSession }>,
  session: Pick<AgentSession, "id" | "workspaceId">
): CelestialBody => {
  const uses = planetsInUse(sessions, session);
  const [deathStar] = CELESTIAL_RARE;

  if (rollsDeathStar(session.id) && !uses.has(deathStar)) return deathStar;

  const start = seed(session.id) % CELESTIAL_PLANETS.length;
  let best: CelestialBody = CELESTIAL_PLANETS[start] ?? "ringed";
  let fewest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < CELESTIAL_PLANETS.length && fewest > 0; i++) {
    const planet = CELESTIAL_PLANETS[(start + i) % CELESTIAL_PLANETS.length] ?? best;
    const count = uses.get(planet) ?? 0;

    if (count < fewest) {
      best = planet;
      fewest = count;
    }
  }

  return best;
};

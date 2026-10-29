/**
 * Celestials (CONTEXT.md): the preset bodies that mark Agent Sessions. The Daemon assigns each
 * session a planet when it is created; Leads show a star and Subagents a moon, derived by Clients.
 * See docs/adr/0085-a-session-s-celestial-is-assigned-at-creation.md.
 */
import { Schema } from "effect";

/** The planets, in the order the Daemon offers them; a newer Daemon may append more. */
export const CELESTIAL_PLANETS = [
  "ringed",
  "banded",
  "cratered",
  "crescent",
  "storm",
  "polar",
  "tilted-ring",
  "striped",
  "spotted",
  "twin-ring",
  "giant",
  "dwarf",
] as const;

/** A Lead's star, chosen from its planet so a session keeps its own star across hand-overs. */
export const CELESTIAL_STARS = ["star-cross", "star-eight", "star-spark"] as const;

/** A Subagent's moon, chosen by its place among its parent's Subagents. */
export const CELESTIAL_MOONS = ["moon-full", "moon-crescent", "moon-cratered"] as const;

export type CelestialPlanet = (typeof CELESTIAL_PLANETS)[number];

/**
 * A body by name. Open, so a body only a newer Daemon draws still decodes; Clients draw an
 * unknown body as the first planet.
 */
export const CelestialBody = Schema.String;

export type CelestialBody = typeof CelestialBody.Type;

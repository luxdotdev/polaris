/**
 * The terminal morph (DESIGN.md, Motion → Morphs): a card's foot divides into the terminal card
 * (and, in the Editor, the status strip under it), and joins back when the terminal hides.
 */
import { MORPH_EASE, MORPH_MS, reducedMotion } from "@polaris/ui";

/** How long the terminal stays mounted after it hides, for the join to play. */
export const EXIT_MS = 200;

const EXIT_EASE = "cubic-bezier(0.215, 0.61, 0.355, 1)";

const FADE_MS = 150;

const GAP = 6;

const CARD_RADIUS = 18;

const STRIP_RADIUS = 12;

/** The furthest the terminal card may pass its resting place: less than the gap above it. */
const MAX_OVERSHOOT = 4;

/** The well's clip while a morph plays: open above and beside, cut at the strip's top edge. */
const cut = (below: number) => `inset(-24px -2px -${below}px -2px)`;

/** How far under the well the terminal starts: the strip's top edge, or the column's foot. */
const belowWell = (strip: boolean) => (strip ? GAP : 0);

const SAMPLES = MORPH_EASE.slice("linear(".length, -1).split(",").map(Number);

/** The column's parts at one split: 0 is one card (terminal hidden), 1 is divided and at rest. */
export interface Split {
  /** How far below its resting place the terminal card sits. */
  readonly drop: number;
  /** How far the editor card's stand-in edge has pulled up from the strip's top. */
  readonly lift: number;
  /** The stand-in edge's corner radius. */
  readonly edge: number;
  /** The strip's top and bottom corner radii. */
  readonly top: number;
  readonly bottom: number;
}

/**
 * Without a strip the terminal rises from the column's foot, and the stand-in edge is the joined
 * card's own foot, so it keeps the card's radius throughout.
 */
export const splitAt = (height: number, split: number, strip = true): Split => {
  const progress = Math.min(1, Math.max(0, split));
  const below = belowWell(strip);

  return {
    drop: (height + below) * (1 - split),
    lift: (height + GAP + below) * progress,
    edge: strip ? CARD_RADIUS * progress : CARD_RADIUS,
    top: STRIP_RADIUS * progress,
    bottom: CARD_RADIUS - (CARD_RADIUS - STRIP_RADIUS) * progress,
  };
};

/** The morph spring from `from` to 1, its overshoot capped at `MAX_OVERSHOOT` px of `travel`. */
export const springSteps = (travel: number, from: number): readonly number[] => {
  const left = (1 - from) * travel;
  const over = (Math.max(...SAMPLES) - 1) * left;
  const scale = over > MAX_OVERSHOOT ? MAX_OVERSHOOT / over : 1;

  return SAMPLES.map((sample) => {
    const eased = sample > 1 ? 1 + (sample - 1) * scale : sample;

    return from + (1 - from) * eased;
  });
};

/** The column's elements the morph paints. */
export interface Parts {
  readonly card: HTMLElement;
  readonly well: HTMLElement;
  readonly terminal: HTMLElement;
  /** Null in a column with no status strip. */
  readonly strip: HTMLElement | null;
  readonly fill: HTMLElement;
}

const part = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLElement>(`[data-morph="${name}"]`);

/** The parts under the column's root, or null unless the terminal is laid out. */
export const partsIn = (root: HTMLElement): Parts | null => {
  const card = part(root, "card");
  const well = part(root, "well");
  const terminal = part(root, "terminal");
  const strip = part(root, "strip");
  const fill = part(root, "fill");

  if (card === null || well === null || terminal === null || fill === null) return null;

  return { card, well, terminal, strip, fill };
};

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

const keyframes = (height: number, steps: readonly number[], strip: boolean) => {
  const at = steps.map((step) => splitAt(height, step, strip));

  return {
    terminal: at.map((a) => ({ transform: `translateY(${px(a.drop)})` })),
    fill: at.map((a) => ({
      visibility: "visible",
      clipPath: `inset(0px 0px ${px(a.lift)} 0px round 0px 0px ${px(a.edge)} ${px(a.edge)})`,
    })),
    strip: at.map((a) => ({
      borderRadius: `${px(a.top)} ${px(a.top)} ${px(a.bottom)} ${px(a.bottom)}`,
    })),
  };
};

/** The test DOM has no running animations; there the column just changes. */
const canMorph = (element: HTMLElement) =>
  "getAnimations" in element && "DOMMatrixReadOnly" in globalThis;

const stop = (element: HTMLElement) => {
  for (const animation of element.getAnimations()) animation.cancel();
};

/** The split the column is at now, read from where the terminal card is painted. */
const splitNow = ({ terminal, strip }: Parts) => {
  const travel = terminal.offsetHeight + belowWell(strip !== null);
  const dropped = new DOMMatrixReadOnly(getComputedStyle(terminal).transform).m42;

  return Math.min(1, Math.max(0, 1 - dropped / travel));
};

const moving = ({ well, terminal, strip, fill }: Parts) =>
  strip === null ? [well, terminal, fill] : [well, terminal, strip, fill];

/**
 * Paints the stand-in edge with the card's scene, where it has one: the art reaches the column's
 * foot (`data-scene-frame`), so the same background, offset, continues it under the card.
 */
const paintFill = (fill: HTMLElement, card: HTMLElement) => {
  const scene = card.querySelector<HTMLElement>('[data-slot="scene"]');

  if (scene === null) {
    fill.style.backgroundImage = "";

    return;
  }

  const art = getComputedStyle(scene);
  const [x = "0px", y = "0px"] = art.backgroundPosition.split(" ");
  const offset = fill.getBoundingClientRect().top - scene.getBoundingClientRect().top;

  fill.style.backgroundImage = art.backgroundImage;
  fill.style.backgroundSize = art.backgroundSize;
  fill.style.backgroundPosition = `${x} calc(${y} - ${offset}px)`;
};

const play = (parts: Parts, steps: readonly number[], timing: KeyframeAnimationOptions) => {
  const { card, well, terminal, strip, fill } = parts;
  const height = terminal.offsetHeight;
  const below = belowWell(strip !== null);
  const frames = keyframes(height, steps, strip !== null);

  for (const element of moving(parts)) stop(element);

  // The fill spans from inside the card's bottom corners down to the strip's top (or the foot).
  fill.style.top = `${card.offsetTop + card.offsetHeight - CARD_RADIUS}px`;
  fill.style.height = `${CARD_RADIUS + GAP + below + height}px`;
  paintFill(fill, card);

  fill.animate(frames.fill, timing);
  well.animate([{ clipPath: cut(below) }, { clipPath: cut(below) }], timing);
  terminal.animate(frames.terminal, timing);
  strip?.animate(frames.strip, timing);
};

const fade = (element: Element) =>
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });

/**
 * Divides the card: the terminal rises out of the strip. `fresh` is a terminal that just
 * mounted (from one card); otherwise it starts from where an interrupted join left it.
 * Web Animations, not CSS: Reduce Motion zeroes CSS transitions, and its crossfade must play.
 */
export const playDivide = (parts: Parts, fresh: boolean) => {
  if (!canMorph(parts.terminal)) return;

  if (reducedMotion()) {
    for (const element of moving(parts)) stop(element);

    if (fresh) {
      if (parts.strip !== null) fade(parts.strip);
      fade(parts.terminal);
    }

    return;
  }

  const from = fresh ? 0 : splitNow(parts);

  play(parts, springSteps(parts.terminal.offsetHeight + belowWell(parts.strip !== null), from), {
    duration: MORPH_MS,
    easing: "linear",
  });
};

/** Joins the card back from where it is now, and holds there until the layout changes. */
export const playJoin = (parts: Parts) => {
  if (!canMorph(parts.terminal) || reducedMotion()) return;

  play(parts, [splitNow(parts), 0], { duration: EXIT_MS, easing: EXIT_EASE, fill: "forwards" });
};

/** The foot layout is back: drop the fill's held frame; Reduce Motion fades the row in. */
export const settle = (root: HTMLElement) => {
  const fill = part(root, "fill");
  const row = root.querySelector<HTMLElement>('[data-slot="status-row"]');

  if (fill !== null && canMorph(fill)) stop(fill);

  if (row !== null && canMorph(row) && reducedMotion()) fade(row);
};

/** How long to keep a hidden terminal mounted: no hold when nothing will play. */
export const exitMs = () => (reducedMotion() ? 0 : EXIT_MS);

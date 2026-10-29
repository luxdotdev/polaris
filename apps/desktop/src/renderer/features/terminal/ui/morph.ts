/**
 * The status row's move between the editor card's foot and its own strip (DESIGN.md, Chrome
 * redesign → Editor): ~200ms on transform only, a crossfade under Reduce Motion.
 */
import { reducedMotion } from "@polaris/ui";

export const MORPH_MS = 200;

const FADE_MS = 150;

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

/** Where the row was before the change, read before React touches the DOM. */
export interface MorphFrom {
  readonly left: number;
  readonly top: number;
}

/** The transform that puts the row back where it was; the animation then plays it to none. */
export const morphOffset = (from: MorphFrom, to: MorphFrom) =>
  `translate(${from.left - to.left}px, ${from.top - to.top}px)`;

const fade = (element: Element) =>
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });

/**
 * Web Animations, not CSS transitions: the app's Reduce Motion zeroes every transition, and the
 * crossfade must still play.
 */
export const playMorph = (row: Element, from: MorphFrom, terminal: Element | null) => {
  if (reducedMotion()) {
    fade(row);

    if (terminal !== null) fade(terminal);

    return;
  }

  const to = row.getBoundingClientRect();

  row.animate([{ transform: morphOffset(from, to) }, { transform: "none" }], {
    duration: MORPH_MS,
    easing: EASE,
  });

  // The terminal card grows into the gap the row leaves: up from where the row sat, fading in.
  if (terminal !== null)
    terminal.animate(
      [
        {
          transform: `translateY(${Math.max(0, from.top - terminal.getBoundingClientRect().top)}px)`,
          opacity: 0,
        },
        { transform: "none", opacity: 1 },
      ],
      { duration: MORPH_MS, easing: EASE }
    );
};

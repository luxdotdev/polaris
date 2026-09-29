import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge must know the Polaris scale, or text-caption and text-text-subtle collide. */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "display",
        "title",
        "heading",
        "heading-sm",
        "body",
        "label",
        "caption",
        "code",
        "code-inline",
        "micro",
      ],
      "font-weight": ["regular", "medium"],
      radius: ["control", "row", "card", "full"],
      shadow: ["float"],
      spacing: [
        "row",
        "tree-row",
        "session-row",
        "harness-tile",
        "row-x",
        "gap",
        "panel",
        "section",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

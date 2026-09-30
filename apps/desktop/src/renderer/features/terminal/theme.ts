/**
 * The xterm theme, read from DESIGN.md's tokens on the live document so it
 * follows the theme. ANSI colours stay moonlit (rule/syntax-is-moonlit): low
 * chroma, built from the syntax and diff tokens, never a signal hue at full.
 */
import type { ITheme } from "@xterm/xterm";

/**
 * Resolves a CSS colour (tokens use `light-dark()` and `color-mix()`) to
 * `rgba(…)`: a probe element computes it, a 1px canvas flattens it to sRGB.
 */
const resolver = () => {
  const probe = document.createElement("span");
  const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true });

  probe.style.display = "none";
  document.body.append(probe);

  const read = (value: string) => {
    probe.style.color = value;
    const computed = getComputedStyle(probe).color;

    if (pixel === null) return computed;
    pixel.clearRect(0, 0, 1, 1);
    pixel.fillStyle = computed;
    pixel.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;

    return `rgba(${r}, ${g}, ${b}, ${((a ?? 255) / 255).toFixed(3)})`;
  };

  return { read, done: () => probe.remove() };
};

const token = (name: string) => `var(--color-${name})`;

const mix = (name: string, percent: number, base: string) =>
  `color-mix(in oklab, ${token(name)} ${percent}%, ${base})`;

export const terminalTheme = (): ITheme => {
  const { read, done } = resolver();
  const fg = token("text-default");

  const theme: ITheme = {
    background: read(token("bg")),
    foreground: read(fg),
    cursor: read(token("text-strong")),
    cursorAccent: read(token("bg")),
    selectionBackground: read(mix("text-strong", 22, "transparent")),
    selectionInactiveBackground: read(mix("text-strong", 12, "transparent")),
    black: read(token("surface-sunken")),
    red: read(mix("diff-removed-text", 80, fg)),
    green: read(mix("diff-added-text", 80, fg)),
    yellow: read(token("syntax-string")),
    blue: read(token("syntax-keyword")),
    magenta: read(mix("syntax-keyword", 60, token("syntax-string"))),
    cyan: read(token("syntax-type")),
    white: read(fg),
    brightBlack: read(token("text-subtle")),
    brightRed: read(token("diff-removed-text")),
    brightGreen: read(token("diff-added-text")),
    brightYellow: read(mix("syntax-string", 80, token("text-strong"))),
    brightBlue: read(mix("syntax-keyword", 80, token("text-strong"))),
    brightMagenta: read(mix("syntax-keyword", 50, token("diff-removed-text"))),
    brightCyan: read(mix("syntax-type", 80, token("text-strong"))),
    brightWhite: read(token("text-strong")),
  };

  done();

  return theme;
};

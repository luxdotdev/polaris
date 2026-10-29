import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Button } from "../ui/button";
import { Badge } from "./badge";
import { GIT_TINTS } from "./git-status-letter";
import { Row } from "./row";
import { SEVERITIES, SeverityBadge } from "./severity-badge";

afterEach(cleanup);

const styles = (file: string) => readFileSync(join(import.meta.dir, "../../styles", file), "utf8");

const tokensCss = styles("tokens.css");

const themeCss = styles("theme.css");

/** WCAG relative luminance of an opaque #rrggbb. */
function luminance(hex: string): number {
  const channel = (offset: number) => {
    const c = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** `--color-*` tokens in a block as [light, dark] arms; a single value fills both. */
function pairs(css: string): Map<string, readonly [string, string]> {
  const found = new Map<string, readonly [string, string]>();

  for (const [, name = "", value = ""] of css.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) {
    const pair = /^light-dark\((#[0-9a-f]{6}), (#[0-9a-f]{6})\)$/.exec(value.trim());
    const single = /^#[0-9a-f]{6}$/.exec(value.trim())?.[0];

    if (pair?.[1] !== undefined && pair[2] !== undefined) found.set(name, [pair[1], pair[2]]);
    else if (single !== undefined) found.set(name, [single, single]);
  }

  return found;
}

const SURFACES = ["ground", "panel", "raised", "well", "well-raised"] as const;

/** Each theme's chrome surfaces and text tokens, as the CSS resolves them. */
function themes() {
  const base = pairs(tokensCss);
  const midnightBlock = /\[data-theme-dark="midnight"\]\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? "";
  const midnight = new Map([...base, ...pairs(midnightBlock)]);

  const arm = (source: Map<string, readonly [string, string]>, index: 0 | 1) =>
    new Map([...source].map(([name, value]) => [name, value[index]]));

  return { light: arm(base, 0), moonlit: arm(base, 1), midnight: arm(midnight, 1) };
}

describe("rule/signal-text-variants", () => {
  test("severity badges set label and glyph in the -text variant on the base-hue fill", () => {
    for (const severity of SEVERITIES) {
      const { container } = render(<SeverityBadge severity={severity} />);
      const badge = container.querySelector<HTMLElement>("[data-slot=severity-badge]");
      const glyph = badge?.querySelector<SVGElement>("svg");

      expect(badge?.style.getPropertyValue("--severity-text")).toBe(
        `var(--color-severity-${severity}-text)`
      );
      expect(badge?.style.getPropertyValue("--severity-fill")).toBe(
        `var(--color-severity-${severity}-fill)`
      );
      expect(glyph?.style.color).toBe(`var(--color-severity-${severity}-text)`);
      cleanup();
    }
  });

  test("git letters and tinted names use the -text variants, except ignored", () => {
    for (const [status, tint] of Object.entries(GIT_TINTS)) {
      if (status === "ignored") expect(tint).toBe("text-text-faint");
      else expect(tint).toMatch(/^text-(git-modified|diff-added|diff-removed)-text$/);
    }
  });

  test("the needs-you second line, needs-you counts and the danger label", () => {
    const { container } = render(
      <>
        <Row
          variant="session"
          tone="needs-you"
          title="Spike"
          description="Wants to run cargo build"
        />
        <Badge tone="needs-you">2</Badge>
        <Button variant="danger">Remove host</Button>
      </>
    );

    expect(container.innerHTML).toContain("text-needs-you-text");
    expect(container.querySelector("[data-slot=badge]")?.className).toContain("bg-needs-you-fill");
    expect(container.querySelector("[data-variant=danger]")?.className).toContain(
      "text-failed-text"
    );
  });
});

describe("rule/faint-is-not-content", () => {
  const root = join(import.meta.dir, "..");

  const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".tsx") && !file.includes(".test.")
  );

  test("text-faint only colours placeholders, disabled text and ignored files", () => {
    const allowed = /placeholder\]?:text-text-faint|ignored: "text-text-faint"/;

    for (const file of files) {
      for (const line of readFileSync(join(root, file), "utf8").split("\n")) {
        if (line.includes("text-text-faint") && !allowed.test(line)) {
          throw new Error(`${file}: text-faint on content: ${line.trim()}`);
        }
      }
    }
  });
});

describe("the chrome's surfaces (DESIGN.md, Chrome redesign: Text)", () => {
  const all = themes();

  test("every theme defines ground, panel, raised and well", () => {
    for (const colours of Object.values(all)) {
      for (const surface of SURFACES) expect(colours.get(surface)).toMatch(/^#[0-9a-f]{6}$/);
    }

    expect(all.midnight.get("ground")).not.toBe(all.moonlit.get("ground"));
  });

  test("strong, default and subtle text and every -text variant clear 4.5:1 on each", () => {
    for (const [theme, colours] of Object.entries(all)) {
      const texts = [...colours].filter(([name]) =>
        /^text-(strong|default|subtle)$|-text$/.test(name)
      );

      expect(texts.length).toBeGreaterThan(15);

      for (const surface of SURFACES) {
        const ground = colours.get(surface) ?? "";

        for (const [name, colour] of texts) {
          const ratio = contrast(colour, ground);

          if (ratio < 4.5)
            throw new Error(`${theme}: ${name} on ${surface} is ${ratio.toFixed(2)}:1`);
        }
      }
    }
  });

  test("text-faint stays below 4.5:1, so it can't pass for content", () => {
    for (const colours of Object.values(all)) {
      for (const surface of SURFACES) {
        expect(contrast(colours.get("text-faint") ?? "", colours.get(surface) ?? "")).toBeLessThan(
          4.5
        );
      }
    }
  });
});

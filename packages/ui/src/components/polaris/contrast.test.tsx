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

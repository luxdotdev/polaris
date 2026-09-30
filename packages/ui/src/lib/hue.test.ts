import { HARNESS_CATALOGUE } from "@polaris/protocol";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { harnessHue, harnessTextVar, hueSlug, hueVar, resolveTint, washVar } from "./hue";

const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");

const assets = readFileSync(new URL("../styles/assets.css", import.meta.url), "utf8");

describe("harnessHue", () => {
  test("takes name, handle and hue from the catalogue", () => {
    expect(harnessHue("claude")).toMatchObject({
      name: "Claude Code",
      handle: "@claude",
      hue: "claude-code",
    });
    expect(harnessHue("codex").hue).toBe("codex");
  });

  test("every hued catalogue Harness has its hue, wash and halo in both themes", () => {
    for (const entry of HARNESS_CATALOGUE.filter((harness) => harness.hued !== false)) {
      const slug = hueSlug(entry.name);

      expect(tokens).toContain(`--color-harness-${slug}: light-dark(`);
      expect(assets.match(new RegExp(`--wash-${slug}: url`, "g"))?.length).toBe(3);
      expect(assets.match(new RegExp(`--halo-${slug}: url`, "g"))?.length).toBe(3);
    }
  });

  test("OpenCode needs only a catalogue entry: its tokens are already there", () => {
    const slug = hueSlug("OpenCode");

    expect(slug).toBe("opencode");
    expect(tokens).toContain(`--color-harness-${slug}: light-dark(`);
    expect(assets).toContain(`--wash-${slug}: url`);
    expect(assets).toContain(`--halo-${slug}: url`);
  });

  test("a catalogue Harness without a hue yet is neutral, named from the catalogue", () => {
    expect(harnessHue("gemini")).toMatchObject({
      name: "Gemini CLI",
      handle: "@gemini",
      hue: null,
    });
    expect(harnessHue("copilot").setup?.docsUrl).toContain("docs.github.com");
    expect(resolveTint("copilot")).toBe("neutral");
    expect(washVar("gemini")).toBe("none");
  });

  test("an unknown kind is neutral, named by its kind", () => {
    const unknown = harnessHue("aider");

    expect(unknown).toMatchObject({ name: "aider", handle: "@aider", hue: null, setup: null });
    expect(resolveTint("aider")).toBe("neutral");
    expect(hueVar("aider")).toBe("var(--color-text-subtle)");
    expect(washVar("aider")).toBe("none");
  });

  test("Harness text falls back to the hue where no -text token exists", () => {
    expect(harnessTextVar("claude")).toBe(
      "var(--color-harness-claude-code-text, var(--color-harness-claude-code))"
    );
  });
});

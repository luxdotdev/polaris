import { CELESTIAL_MOONS, CELESTIAL_PLANETS, CELESTIAL_STARS } from "@polaris/protocol";

import { Celestial, type CelestialSize } from "../../src";
import { Section, Swatch } from "./layout";

const SIZES: readonly CelestialSize[] = [16, 24, 32];

const HARNESSES = ["claude", "codex", "opencode"] as const;

const BODIES = [...CELESTIAL_PLANETS, ...CELESTIAL_STARS, ...CELESTIAL_MOONS];

/** DESIGN.md, Celestials: the set, each size, Working, and Dormant. */
export function CelestialSection() {
  return (
    <Section title="Celestials">
      {HARNESSES.map((harness) => (
        <div key={harness} className="flex flex-wrap items-end gap-3">
          {BODIES.map((body) => (
            <Swatch key={body} label={body}>
              <Celestial body={body} harness={harness} size={32} />
            </Swatch>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-4">
        {SIZES.map((size) => (
          <Swatch key={size} label={`${size}`}>
            <Celestial body="ringed" harness="claude" size={size} />
          </Swatch>
        ))}
        {SIZES.map((size) => (
          <Swatch key={`working-${size}`} label={`working ${size}`}>
            <Celestial body="banded" harness="codex" size={size} working />
          </Swatch>
        ))}
        <Swatch label="lead working 24">
          <Celestial body="star-eight" harness="claude" size={24} working />
        </Swatch>
        <Swatch label="dormant 24">
          <Celestial body="storm" harness="claude" size={24} dormant />
        </Swatch>
      </div>
    </Section>
  );
}

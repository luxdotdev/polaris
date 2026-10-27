import { type MobileTextRole, mobileType } from "../../src/tokens";
import { Section } from "./layout";

const SAMPLES: readonly (readonly [MobileTextRole, string])[] = [
  ["largeTitle", "Sessions"],
  ["title", "Spike GPUI review screen"],
  ["body", "Wants to run a command outside the workspace."],
  ["heading", "Polaris planning"],
  ["callout", "Asks · Enter household income as annual or monthly?"],
  ["label", "Approve"],
  ["subhead", "4 hosts"],
  ["footnote", "Codex · Mac Studio · 42m"],
  ["section", "Needs you"],
  ["tab", "Sessions"],
  ["command", "$ cargo build --release"],
  ["index", "01"],
];

/** The Mobile App's type scale, drawn from the same constants apps/mobile imports. */
export function MobileTypeSection() {
  return (
    <Section title="Mobile type">
      <div className="flex flex-col gap-2">
        {SAMPLES.map(([role, sample]) => (
          <div key={role} className="flex items-baseline gap-3">
            <span className="text-caption text-text-subtle tabular w-28 shrink-0">
              {role} {mobileType[role].fontSize}/{mobileType[role].lineHeight}
            </span>
            <span className="text-text-strong" style={mobileType[role]}>
              {sample}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

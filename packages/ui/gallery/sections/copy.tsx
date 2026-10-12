import { useEffect, useRef } from "react";

import { CopyButton, type CopyButtonProps, CopyProvider, type CopyWrite } from "../../src";
import { Section, Swatch } from "./layout";

const WRITERS: Readonly<Record<"idle" | "copied" | "failed", CopyWrite>> = {
  idle: async () => true,
  copied: async () => true,
  failed: async () => false,
};

/** Clicks once on mount and holds the answer, so each state stays on screen. */
function Held({ state, ...props }: CopyButtonProps & { readonly state: keyof typeof WRITERS }) {
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (state !== "idle") root.current?.querySelector("button")?.click();
  }, [state]);

  return (
    <CopyProvider write={WRITERS[state]}>
      <span ref={root}>
        <CopyButton {...props} resetMs={2_000_000_000} />
      </span>
    </CopyProvider>
  );
}

const VARIANTS: ReadonlyArray<readonly [string, Omit<CopyButtonProps, "text">]> = [
  ["inline", { variant: "inline" }],
  ["icon", { variant: "icon", label: "Copy code" }],
  ["button", { variant: "button", label: "Copy command" }],
];

export function CopySection() {
  return (
    <Section title="Copy button">
      <div className="flex flex-col gap-3">
        {VARIANTS.map(([name, props]) => (
          <div key={name} className="flex items-end gap-6">
            <span className="text-caption text-text-subtle w-14 shrink-0">{name}</span>
            {(["idle", "copied", "failed"] as const).map((state) => (
              <Swatch key={state} label={state}>
                <Held state={state} text="brew install shellcheck" {...props} />
              </Swatch>
            ))}
            <Swatch label="live">
              <CopyButton text="brew install shellcheck" {...props} />
            </Swatch>
          </div>
        ))}
      </div>
    </Section>
  );
}

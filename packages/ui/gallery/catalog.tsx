import { ControlsSection, TypeSection, ColourSection } from "./sections/basics";
import { FloatingSection, ComposerSection } from "./sections/floating";
import { IdentitySection, SignalSection } from "./sections/identity";
import { ListSection } from "./sections/lists";
import { PixelWorldSection } from "./sections/pixel-world";

export interface CatalogProps {
  readonly density: string;
}

function Column({
  theme,
  density,
}: {
  readonly theme: "dark" | "light";
  readonly density: string;
}) {
  return (
    <div
      data-theme={theme}
      data-density={density}
      className="gap-section flex min-w-0 flex-1 flex-col p-6"
    >
      <p className="text-caption text-text-faint">
        {theme} · {density}
      </p>
      <TypeSection />
      <ColourSection />
      <ControlsSection />
      <IdentitySection />
      <SignalSection />
      <ListSection />
      <ComposerSection />
      <FloatingSection />
      <PixelWorldSection />
    </div>
  );
}

/** Every component and state, dark and light side by side. */
export function Catalog({ density }: CatalogProps) {
  return (
    <main className="flex min-w-[1280px]">
      <Column theme="dark" density={density} />
      <Column theme="light" density={density} />
    </main>
  );
}

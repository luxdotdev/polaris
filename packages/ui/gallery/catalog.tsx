import { CoverageSection } from "./sections/coverage";
import { ControlsSection, TypeSection, ColourSection } from "./sections/basics";
import { FloatingSection, ComposerSection } from "./sections/floating";
import { IdentitySection, SignalSection } from "./sections/identity";
import { ListSection } from "./sections/lists";
import { PixelWorldSection } from "./sections/pixel-world";

export interface CatalogProps {
  readonly density: string;
  readonly textSize: string;
  readonly palette: string;
  /** "coverage" renders only the M1 coverage components. */
  readonly only?: string | null;
}

interface ColumnProps extends CatalogProps {
  readonly theme: "dark" | "light";
}

function Column({ theme, density, textSize, palette, only }: ColumnProps) {
  return (
    <div
      data-theme={theme}
      data-density={density}
      data-text-size={textSize}
      data-diff-palette={palette}
      className="gap-section flex min-w-0 flex-1 flex-col p-6"
    >
      <p className="text-caption text-text-subtle">
        {theme} · {density} · text {textSize} · {palette} diffs
      </p>
      {only === "coverage" ? (
        <CoverageSection />
      ) : (
        <>
          <TypeSection />
          <ColourSection />
          <ControlsSection />
          <IdentitySection />
          <SignalSection />
          <ListSection />
          <ComposerSection />
          <FloatingSection />
          <PixelWorldSection />
          <CoverageSection />
        </>
      )}
    </div>
  );
}

/** Every component and state, dark and light side by side. */
export function Catalog(props: CatalogProps) {
  return (
    <main className="flex min-w-[1280px]">
      <Column theme="dark" {...props} />
      <Column theme="light" {...props} />
    </main>
  );
}

import {
  Button,
  Clearing,
  Dither,
  EmptyState,
  PixelHandIcon,
  PixelPolarisIcon,
  Scene,
  Wordmark,
} from "../../src";
import { Section, Swatch } from "./layout";

export function PixelWorldSection() {
  return (
    <Section title="Dither, scenes and empty states">
      <div className="flex flex-wrap items-end gap-4">
        <Swatch label="working 12">
          <Dither hue="claude" size={12} moving />
        </Swatch>
        <Swatch label="working 16">
          <Dither hue="claude" size={16} moving />
        </Swatch>
        <Swatch label="working 24">
          <Dither hue="codex" size={24} moving />
        </Swatch>
        <Swatch label="polaris 16">
          <Dither hue="starlight" size={16} moving />
        </Swatch>
        <Swatch label="starting (still, 50%)">
          <Dither hue="claude" size={16} dim />
        </Swatch>
        <Swatch label="band 120×6">
          <Dither hue="claude" width={120} height={6} moving />
        </Swatch>
      </div>
      <Scene className="rounded-card flex h-72 flex-col items-center justify-center">
        <Clearing className="flex flex-col items-center gap-2 text-center">
          <Wordmark size={32} />
          <p className="text-heading text-text-strong">The north star for your agents.</p>
          <p className="text-caption text-text-default">
            Launch, steer and review Claude Code and Codex on this Mac and every host you reach over
            SSH.
          </p>
          <Button variant="primary" className="mt-2">
            Get started
          </Button>
        </Clearing>
      </Scene>
      <div className="rounded-card border-hairline grid grid-cols-2 gap-3 border">
        <EmptyState
          hue="starlight"
          icon={<PixelPolarisIcon size={24} className="text-starlight" />}
          title="Nothing needs you"
          fact="4 sessions on 2 hosts are working or idle."
        />
        <EmptyState
          hue="claude"
          icon={<PixelHandIcon size={24} className="text-text-subtle" />}
          title="No agent sessions in polaris"
          fact="Mac Studio · ~/code/polaris"
          action={<Button>New session</Button>}
        />
      </div>
    </Section>
  );
}

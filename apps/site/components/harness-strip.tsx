export function HarnessStrip() {
  return (
    <section
      aria-label="Supported agents"
      className="flex flex-col items-center gap-3.5 px-5 pt-10 md:flex-row md:justify-center md:gap-10 md:pt-12"
    >
      <p className="text-site-muted text-[15px] leading-[22px] md:text-[16px] md:leading-6">
        Works with the agents you already use
      </p>
      <span aria-hidden="true" className="bg-site-rule hidden h-6 w-px md:block" />
      <ul className="flex gap-7 md:gap-10">
        <Harness name="Claude Code" wash="wash-claude-code" dither="px-dither-claude" />
        <Harness name="Codex" wash="wash-codex" dither="px-dither-codex" />
      </ul>
    </section>
  );
}

function Harness({
  name,
  wash,
  dither,
}: {
  readonly name: string;
  readonly wash: string;
  readonly dither: string;
}) {
  return (
    <li className="flex items-center gap-2.5 md:gap-3">
      <span
        aria-hidden="true"
        className={`flex size-7 items-center justify-center rounded-[7px] bg-cover bg-center md:size-8 md:rounded-[8px] ${wash}`}
      >
        <span className={`px-icon size-3.5 md:size-4 ${dither}`} />
      </span>
      <span className="text-text-strong text-[16px] leading-[22px] font-medium md:text-[18px] md:leading-6">
        {name}
      </span>
    </li>
  );
}

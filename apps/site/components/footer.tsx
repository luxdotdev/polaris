import { links } from "./links";
import { Lockup } from "./nav";

const columns = [
  {
    title: "Product",
    items: [
      { label: "Download", href: links.download },
      { label: "Changelog", href: links.changelog },
      { label: "Docs", href: links.docs },
    ],
  },
  {
    title: "Open source",
    items: [
      { label: "GitHub", href: links.source },
      { label: "License", href: links.license },
      { label: "Attribution", href: links.attribution },
    ],
  },
  {
    title: "Brand",
    items: [
      { label: "Brand guidelines", short: "Guidelines", href: links.brand },
      { label: "Press kit", href: links.pressKit },
    ],
  },
] as const;

export function Footer() {
  return (
    <footer className="border-site-rule bg-site-footer border-t">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 pt-10 pb-12 md:px-12 lg:gap-12 lg:pt-14 xl:px-[120px]">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-16">
          <div className="flex flex-col gap-2.5 lg:grow lg:gap-3">
            <span className="hidden lg:block">
              <Lockup size={20} />
            </span>
            <span className="lg:hidden">
              <Lockup size={18} />
            </span>
            <p className="text-site-kicker text-[15px] leading-[22px]">
              The north star for your agents.
            </p>
            <p className="text-site-kicker pt-2 text-[14px] leading-5 lg:pt-5">
              An open source project by lux.dev
            </p>
          </div>
          <nav aria-label="Footer" className="flex gap-6 lg:gap-16">
            {columns.map((column) => (
              <div
                key={column.title}
                className="flex flex-1 basis-0 flex-col gap-3 lg:w-40 lg:flex-none"
              >
                <h2 className="text-site-kicker text-[13px] leading-[18px]">{column.title}</h2>
                <ul className="flex flex-col gap-3">
                  {column.items.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        className="text-site-copy hover:text-text-strong text-[15px] leading-[22px] transition-colors"
                      >
                        {"short" in item ? (
                          <>
                            <span className="hidden md:inline">{item.label}</span>
                            <span className="md:hidden">{item.short}</span>
                          </>
                        ) : (
                          item.label
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="border-site-rule text-site-kicker flex flex-col gap-1.5 border-t pt-5 text-[12px] leading-[18px] lg:flex-row lg:justify-between lg:pt-6 lg:text-[13px]">
          <p>© 2026 lux.dev LLC · Released under Apache-2.0</p>
          <p>Claude Code and Codex are trademarks of their owners</p>
        </div>
      </div>
    </footer>
  );
}

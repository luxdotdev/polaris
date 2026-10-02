import { NavDownload } from "./actions";
import { GitHubIcon } from "./icons";
import { links, navLinks } from "./links";
import { MobileMenu } from "./mobile-menu";
import { Pixel } from "./pixel";

const link = "text-[14px] leading-5 text-site-link transition-colors hover:text-text-strong";

export function Lockup({ size }: { readonly size: 18 | 20 }) {
  return (
    <span className="flex items-center gap-2.5">
      <Pixel art="star" size={size} />
      <span
        className="font-pixel text-text-strong"
        style={{ fontSize: size, lineHeight: `${size}px` }}
      >
        Polaris
      </span>
    </span>
  );
}

/** A solid bar, never text straight on the sky (rule/scene-text-contrast). */
export function Nav() {
  return (
    <header className="border-site-rule bg-site-bar sticky top-0 z-50 border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-[1920px] items-center gap-10 px-5 md:h-[72px] md:px-12"
      >
        <a href="/" aria-label="Polaris home" className="rounded-control">
          <span className="md:hidden">
            <Lockup size={18} />
          </span>
          <span className="hidden md:inline">
            <Lockup size={20} />
          </span>
        </a>
        <ul className="hidden gap-7 md:flex">
          {navLinks.map((item) => (
            <li key={item.label}>
              <a href={item.href} className={link}>
                {item.label}
              </a>
            </li>
          ))}
        </ul>
        <span className="grow" />
        <a href={links.source} className={`hidden items-center gap-2 md:flex ${link}`}>
          <GitHubIcon />
          Open source
        </a>
        <span className="hidden md:block">
          <NavDownload />
        </span>
        <MobileMenu />
      </nav>
    </header>
  );
}

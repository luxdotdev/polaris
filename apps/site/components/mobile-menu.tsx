"use client";

import { useId } from "react";
import { GitHubIcon, MenuIcon } from "./icons";
import { links, navLinks } from "./links";

const item = "flex h-12 items-center gap-2.5 text-[17px] leading-6 text-text-strong";

/** The phone menu: a native popover under the bar, dismissed by a tap outside or a choice. */
export function MobileMenu() {
  const id = useId();

  const close = () => document.getElementById(id)?.hidePopover();

  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label="Menu"
        className="rounded-control text-text-strong -mr-2.5 flex size-11 items-center justify-center md:hidden"
      >
        <MenuIcon />
      </button>
      <div
        id={id}
        popover="auto"
        className="border-site-rule bg-site-bar text-site-copy inset-x-0 top-14 m-0 w-full border-b px-5 pt-2 pb-4 md:hidden"
      >
        <ul>
          {navLinks.map((entry) => (
            <li key={entry.label}>
              <a href={entry.href} onClick={close} className={item}>
                {entry.label}
              </a>
            </li>
          ))}
          <li>
            <a href={links.source} onClick={close} className={item}>
              <GitHubIcon />
              Source on GitHub
            </a>
          </li>
        </ul>
      </div>
    </>
  );
}

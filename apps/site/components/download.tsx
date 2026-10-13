"use client";

import { useSyncExternalStore } from "react";
import { AppleIcon, WindowsIcon } from "./icons";
import { downloadOffer, platformStore } from "./platform";

/** macOS on the server and until hydration; Windows visitors switch once detected. */
function useOffer() {
  const platform = useSyncExternalStore(
    platformStore.subscribe,
    platformStore.snapshot,
    platformStore.serverSnapshot
  );

  return downloadOffer(platform);
}

export function DownloadButton({ className }: { readonly className: string }) {
  const offer = useOffer();

  return (
    <a href={offer.href} className={className}>
      {offer.os === "windows" ? <WindowsIcon /> : <AppleIcon />}
      {offer.label}
      {offer.experimental ? (
        <span className="rounded-full border border-current/30 px-2 text-[12px] leading-[18px] opacity-80">
          Experimental
        </span>
      ) : null}
    </a>
  );
}

export function NavDownloadLink({ className }: { readonly className: string }) {
  const offer = useOffer();

  return (
    <a href={offer.href} className={className}>
      Download
    </a>
  );
}

/** The note under the buttons, then every other platform's download. */
export function DownloadNotes({
  note,
  others = false,
}: {
  readonly note?: string | undefined;
  readonly others?: boolean;
}) {
  const offer = useOffer();
  const line = offer.note ?? note;

  return (
    <>
      {line === undefined ? null : <p className="text-site-copy text-[14px] leading-5">{line}</p>}
      {others ? (
        <p className="text-site-kicker flex flex-wrap items-center justify-center gap-x-2 text-[13px] leading-[18px]">
          <span>{offer.othersLabel}</span>
          {offer.others.map((link, index) => (
            <span key={link.href} className="flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <a
                href={link.href}
                className="text-site-copy hover:text-text-strong underline decoration-current/40 underline-offset-[3px] transition-colors"
              >
                {link.label}
              </a>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );
}

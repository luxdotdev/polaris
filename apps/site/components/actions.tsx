import { EmailDownload } from "./email-download";
import { AppleIcon, GitHubIcon } from "./icons";
import { links } from "./links";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2.5 rounded-[10px] font-medium transition-[background-color,border-color,transform] duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100";

const primary = `${base} bg-site-primary text-site-on-primary shadow-(--site-primary-shadow) hover:bg-site-primary-hover`;

const secondary = `${base} border border-site-secondary-border bg-site-secondary text-text-strong hover:bg-site-secondary-hover`;

const large = "h-12 pl-[18px] pr-[22px] text-[16px] leading-5";

/** The one primary action: the Mac download (a route that redirects to the latest DMG). */
export function DownloadButton() {
  return (
    <a href={links.download} className={`${primary} ${large}`}>
      <AppleIcon />
      Download for macOS
    </a>
  );
}

/** The secondary action is always the source. */
const sourceSizes = {
  large: `${large} pr-5`,
  block: "h-[50px] w-full text-[16px] leading-5",
  compact: "h-11 rounded-[8px] px-[18px] text-[15px] leading-5",
} as const;

export function SourceButton({ size = "large" }: { readonly size?: keyof typeof sourceSizes }) {
  return (
    <a href={links.source} className={`${secondary} ${sourceSizes[size]}`}>
      <GitHubIcon />
      View source
    </a>
  );
}

export function NavDownload() {
  return (
    <a
      href={links.download}
      className={`${primary} rounded-control h-8 px-3.5 text-[14px] leading-5 shadow-none`}
    >
      Download
    </a>
  );
}

/** Desktop: Download and source side by side. Phones: email the Mac download instead (S3). */
export function Actions({
  note,
  mobileNote,
}: {
  readonly note?: string | undefined;
  readonly mobileNote?: string | undefined;
}) {
  return (
    <>
      <div className="hidden flex-col items-center gap-4 pt-3 md:flex">
        <div className="flex items-center gap-3">
          <DownloadButton />
          <SourceButton />
        </div>
        {note === undefined ? null : <p className="text-site-copy text-[14px] leading-5">{note}</p>}
      </div>
      <div className="flex w-full flex-col gap-2.5 md:hidden">
        <EmailDownload />
        <SourceButton size="block" />
        {mobileNote === undefined ? null : (
          <p className="text-site-copy pt-1.5 text-center text-[14px] leading-5">{mobileNote}</p>
        )}
      </div>
    </>
  );
}

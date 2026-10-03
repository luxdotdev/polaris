import { Pixel } from "./pixel";

/** A section kicker: the pixel star, `01 — Supervise`, and a hairline to the edge. */
export function SectionHeader({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-2.5 md:gap-3.5">
      <Pixel art="star" size={16} />
      <p className="text-site-kicker text-[13px] leading-[18px] md:text-[14px] md:leading-5 md:tracking-[0.02em]">
        {label}
      </p>
      <span aria-hidden="true" className="bg-site-rule h-px grow" />
    </div>
  );
}

export const display =
  "text-[36px] leading-10 tracking-[-0.02em] text-text-strong lg:text-[56px] lg:leading-[62px] xl:text-[64px] xl:leading-[70px]";

export const lead = "text-[17px] leading-[26px] text-site-muted lg:text-[20px] lg:leading-[30px]";

export const container = "mx-auto w-full max-w-[1440px] px-5 md:px-12 lg:px-16 xl:px-[120px]";

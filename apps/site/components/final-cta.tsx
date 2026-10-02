import { Actions } from "./actions";
import { Pixel } from "./pixel";

/** The closing sky: one star, one line, the same two actions as the hero. */
export function FinalCta() {
  return (
    <section
      aria-labelledby="steer"
      className="cta-sky mt-28 flex flex-col items-center pt-28 pb-[180px] lg:mt-[200px] lg:px-[120px] lg:pt-[200px] lg:pb-[220px]"
    >
      <div className="clearing flex flex-col items-center gap-5 px-5 pt-10 lg:gap-7 lg:px-40 lg:py-14">
        <Pixel art="logo" size={64} className="lg:hidden" />
        <Pixel art="logo" size={96} className="hidden lg:block" />
        <h2
          id="steer"
          className="text-text-strong max-w-[320px] text-center text-[38px] leading-[42px] tracking-[-0.02em] md:max-w-none lg:text-[72px] lg:leading-[78px]"
        >
          Steer every agent by one star.
        </h2>
        <p className="text-site-copy text-center text-[16px] leading-6 lg:text-[20px] lg:leading-[30px]">
          <span className="hidden md:inline">Free for macOS. Open source under Apache-2.0.</span>
          <span className="md:hidden">Free and open source, for macOS.</span>
        </p>
        <div className="w-full pt-1 md:w-auto md:pt-0">
          <Actions />
        </div>
      </div>
    </section>
  );
}

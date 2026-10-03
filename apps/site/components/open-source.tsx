import { SourceButton } from "./actions";
import { GitHubIcon } from "./icons";
import { links } from "./links";
import { Pixel } from "./pixel";
import { container, display, lead, SectionHeader } from "./section-header";

const promises = [
  {
    title: "Apache-2.0",
    body: "Read it, fork it, build on it. That covers the app and the daemon.",
  },
  { title: "No sign-in", body: "Download it and it opens. No account, no seats, no trial." },
  {
    title: "Your agents",
    body: "Polaris drives your own Claude Code and Codex, on the plans you already have.",
  },
  {
    title: "Your machines",
    body: "The app connects straight to your hosts over SSH. No Polaris server sits in between.",
  },
] as const;

export function OpenSource() {
  return (
    <section
      aria-labelledby="yours"
      className={`${container} flex flex-col gap-[18px] pt-28 md:gap-6 lg:pt-[200px]`}
    >
      <SectionHeader label="03 — Yours" />
      <h2 id="yours" className={`${display} pt-3 lg:max-w-[900px] lg:pt-10`}>
        Free. Open source. No account.
      </h2>
      <p className={`${lead} lg:max-w-[640px]`}>
        No subscription, no trial, no sign-in. Polaris is Apache-2.0: download it, run it, read
        every line.
      </p>
      <div className="flex flex-col gap-6 pt-4 lg:flex-row lg:gap-16 lg:pt-14">
        <ul className="grid gap-5 pb-3 lg:w-[560px] lg:shrink-0 lg:grid-cols-2 lg:gap-x-10 lg:gap-y-10 lg:pt-2 lg:pb-0 xl:w-[620px]">
          {promises.map((promise) => (
            <li
              key={promise.title}
              // "No sign-in" is a desktop-only line in S3.
              className={`flex flex-col gap-1 lg:gap-2 ${promise.title === "No sign-in" ? "hidden lg:flex" : ""}`}
            >
              <h3 className="text-text-strong text-[17px] leading-[22px] font-medium lg:text-[18px] lg:leading-6">
                {promise.title}
              </h3>
              <p className="text-site-copy text-[15px] leading-[23px] lg:text-[16px] lg:leading-6">
                {promise.body}
              </p>
            </li>
          ))}
        </ul>
        <RepoCard />
      </div>
    </section>
  );
}

/** The repository, open: where the notify form stood before the source went public. */
function RepoCard() {
  return (
    <div className="border-site-rule bg-site-card relative flex flex-col gap-5 overflow-clip rounded-[18px] border p-6 lg:grow lg:p-8">
      <span
        aria-hidden="true"
        className="pixelated halo-starlight absolute -top-10 -right-[90px] h-[180px] w-[400px] bg-size-[100%_100%] opacity-80"
      />
      <Pixel art="logo" size={64} className="absolute top-[18px] right-[78px] hidden lg:block" />
      <Pixel art="logo" size={32} className="absolute top-5 right-5 lg:hidden" />
      <a
        href={links.source}
        className="text-text-strong relative flex w-fit items-center gap-2.5 text-[16px] leading-[22px] hover:underline"
      >
        <span className="text-site-copy">
          <GitHubIcon size={18} />
        </span>
        luxdotdev/polaris
      </a>
      <div className="relative flex flex-col gap-2 pt-3">
        <h3 className="text-text-strong text-[24px] leading-[30px] tracking-[-0.01em] lg:text-[26px] lg:leading-8">
          Every line is on GitHub.
        </h3>
        <p className="text-site-muted max-w-[400px] text-[16px] leading-6">
          The app, the daemon and this site, under Apache-2.0. Build it from source, open an issue
          or send a pull request.
        </p>
      </div>
      <div className="relative flex flex-col items-start gap-3 pt-2">
        <code className="border-site-field-border bg-site-field text-site-copy flex h-11 w-full items-center overflow-x-auto rounded-[8px] border px-3.5 font-mono text-[13px] leading-5 whitespace-nowrap">
          git clone {links.source}
        </code>
        <SourceButton size="compact" />
      </div>
    </div>
  );
}

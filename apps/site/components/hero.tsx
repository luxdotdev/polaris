import orchestrateLight from "../../../design/assets/site/shot-orchestrate-light.png";
import orchestrate from "../../../design/assets/site/shot-orchestrate.png";
import { Actions } from "./actions";
import { Shot } from "./shot";

export function Hero() {
  return (
    <section
      aria-labelledby="hero"
      className="mx-auto flex max-w-[1440px] flex-col items-center pb-8 lg:pb-[50px]"
    >
      <div className="clearing flex flex-col items-center gap-5 px-5 pt-14 pb-2 lg:gap-7 lg:px-[200px] lg:pt-24 lg:pb-[34px]">
        <p className="border-site-pill-border bg-site-pill text-site-copy flex h-7 items-center gap-2 rounded-full border pr-3 pl-2.5 text-[13px] leading-4 lg:h-[30px] lg:gap-2.5">
          <span aria-hidden="true" className="bg-starlight size-1.5" />
          Free and open source
        </p>
        <h1
          id="hero"
          className="text-text-strong max-w-[340px] text-center text-[46px] leading-[50px] tracking-[-0.02em] md:max-w-[700px] md:text-[72px] md:leading-[78px] xl:text-[92px] xl:leading-[96px]"
        >
          The north star for your agents.
        </h1>
        <p className="text-site-copy max-w-[340px] text-center text-[17px] leading-[26px] md:max-w-[720px] md:text-[22px] md:leading-8">
          Run Claude Code and Codex side by side, on any machine. Polaris shows what every agent is
          doing, calls you only when one is stuck, and puts the riskiest changes first.
        </p>
        <div className="w-full pt-1 md:w-auto md:pt-0">
          <Actions
            note="For macOS · Agents run locally or over SSH · No account"
            mobileNote="Polaris runs on macOS · No account"
          />
        </div>
      </div>
      <div className="w-full pt-10 pl-5 md:px-12 lg:px-[120px] lg:pt-0">
        <Shot
          alt="The Polaris Orchestrator: agent sessions on several hosts, one asking for approval, beside a review of its changes."
          dark={orchestrate}
          light={orchestrateLight}
          desktop={{ w: 100 }}
          mobile={{ w: 194.59 }}
          aspect={["1200 / 750", "370 / 300"]}
          sizes="(min-width: 1024px) 1200px, 194vw"
          priority
          className="bg-bg lg:rounded-card rounded-l-[12px] shadow-(--site-hero-shadow) md:rounded-[12px]"
        />
      </div>
    </section>
  );
}

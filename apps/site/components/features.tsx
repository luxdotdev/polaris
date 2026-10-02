import constellation from "../../../design/assets/site/shot-constellation.png";
import needsYou from "../../../design/assets/site/shot-needs-you-light.png";
import reviewLight from "../../../design/assets/site/shot-review-light.png";
import review from "../../../design/assets/site/shot-review.png";
import { Pixel, type PixelArt } from "./pixel";
import { container, display, lead, SectionHeader } from "./section-header";
import { Shot, type ShotProps } from "./shot";

interface Feature {
  readonly kicker: string;
  readonly icon: PixelArt;
  readonly title: string;
  readonly body: string;
  readonly mobileBody?: string;
  readonly facts: readonly [string, string, string];
  readonly shot: Omit<ShotProps, "className" | "sizes">;
  /** Which side the shot bleeds off on desktop; on phones every shot bleeds right. */
  readonly bleed: "left" | "right";
}

const features: readonly Feature[] = [
  {
    kicker: "Needs you",
    icon: "hand",
    title: "Only the stuck agent asks for you.",
    body: "When an agent wants to run a command or needs a decision, it goes to the top of one inbox. Approve it, answer it or take over in the terminal. The rest keep working.",
    facts: [
      "One inbox for every agent",
      "Answer straight from the notification",
      "Take over in the terminal, then hand it back",
    ],
    shot: {
      alt: "An agent session that needs you: a command waiting for approval at the top of the session list.",
      dark: needsYou,
      desktop: { w: 174.13 },
      mobile: { w: 272.43, y: -13.33 },
    },
    bleed: "right",
  },
  {
    kicker: "Review",
    icon: "star",
    title: "Read the risky lines first.",
    body: "A reviewer reads every change and ranks what it finds. Mark a finding as fine and it learns, for one change, one repo or everywhere. Critical findings always show.",
    facts: [
      "A risk summary for every turn and pull request",
      "Review in its own checkout, not your working tree",
      "Gets sharper with every verdict",
    ],
    shot: {
      alt: "A review with ranked findings beside the diff they point at.",
      dark: review,
      light: reviewLight,
      desktop: { w: 205.97, x: -39.3, y: -19.35 },
      mobile: { w: 272.43, x: -51.08, y: -28 },
      lightDesktop: { w: 205.97, x: -37.81, y: -8.23 },
      lightMobile: { w: 272.43, x: -50, y: -10.3 },
    },
    bleed: "left",
  },
  {
    kicker: "Constellation",
    icon: "constellation",
    title: "One plan. Many agents.",
    body: "Hand a large change to one agent. It splits the work into tasks, starts an agent on each and holds every merge for review. You see the whole plan as a graph and can steer any agent in it.",
    mobileBody:
      "Hand a large change to one agent. It splits the work into tasks, starts an agent on each and holds every merge for review. Steer any agent in the graph.",
    facts: [
      "Claude Code and Codex in the same plan",
      "Every task on its own worktree",
      "Nothing merges without a review",
    ],
    shot: {
      alt: "A constellation: one plan split into tasks, each with its own agent, shown as a graph.",
      dark: constellation,
      desktop: { w: 197.01, x: -97.39, y: -14.84 },
      mobile: { w: 272.43, x: -134.59, y: -19.67 },
    },
    bleed: "right",
  },
];

const gutterLeft = "lg:pl-16 xl:pl-[max(120px,calc((100%-1200px)/2))]";

const gutterRight = "lg:pr-16 xl:pr-[max(120px,calc((100%-1200px)/2))]";

export function Features() {
  return (
    <section id="features" aria-labelledby="supervise" className="scroll-mt-20">
      <div className={`${container} flex flex-col gap-[18px] pt-24 md:gap-6 lg:pt-44 lg:pb-24`}>
        <SectionHeader label="01 — Supervise" />
        <div className="flex flex-col gap-[18px] pt-3 lg:flex-row lg:items-end lg:gap-16 lg:pt-10 xl:gap-24">
          <h2 id="supervise" className={`${display} lg:w-[560px] lg:shrink-0 xl:w-[640px]`}>
            Supervise your agents. Stop babysitting them.
          </h2>
          <p className={`${lead} lg:w-[480px]`}>
            Agents work for hours, in parallel. Polaris stays quiet until one needs a decision, a
            review or a hand.
          </p>
        </div>
      </div>
      {features.map((feature, index) => (
        <FeatureRow key={feature.kicker} feature={feature} first={index === 0} />
      ))}
    </section>
  );
}

function FeatureRow({ feature, first }: { readonly feature: Feature; readonly first: boolean }) {
  const shotLeft = feature.bleed === "left";

  const direction = shotLeft ? "flex-col lg:flex-row" : "flex-col lg:flex-row-reverse";

  const gutter = shotLeft ? gutterRight : gutterLeft;

  const corners = shotLeft
    ? "rounded-l-[12px] lg:rounded-l-none lg:rounded-r-card"
    : "rounded-l-[12px] lg:rounded-l-card";

  return (
    <article
      className={`mx-auto flex max-w-[1920px] gap-6 pt-14 pl-5 md:pl-12 lg:items-center lg:gap-16 lg:pl-0 xl:gap-24 ${first ? "lg:pt-0" : "lg:pt-40"} ${direction} ${gutter}`}
    >
      <Shot
        {...feature.shot}
        sizes="(min-width: 1024px) 160vw, 272vw"
        className={`bg-bg min-w-0 lg:grow ${corners}`}
      />
      <div className="flex flex-col gap-3.5 pr-5 md:pr-12 lg:w-[360px] lg:shrink-0 lg:gap-5 lg:pr-0 xl:w-[420px]">
        <p className="text-site-copy flex items-center gap-2 text-[13px] leading-[18px] lg:gap-2.5 lg:text-[14px] lg:leading-5">
          <Pixel art={feature.icon} size={16} />
          {feature.kicker}
        </p>
        <h3 className="text-text-strong text-[28px] leading-8 tracking-[-0.015em] lg:text-[40px] lg:leading-[46px]">
          {feature.title}
        </h3>
        <p className="text-site-muted text-[16px] leading-[25px] lg:text-[18px] lg:leading-7">
          <span className={feature.mobileBody === undefined ? "" : "hidden lg:inline"}>
            {feature.body}
          </span>
          {feature.mobileBody === undefined ? null : (
            <span className="lg:hidden">{feature.mobileBody}</span>
          )}
        </p>
        <ul className="text-site-copy hidden flex-col gap-2.5 pt-2 text-[16px] leading-6 lg:flex">
          {feature.facts.map((fact) => (
            <li key={fact}>— {fact}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

import { Features } from "../components/features";
import { FinalCta } from "../components/final-cta";
import { Footer } from "../components/footer";
import { HarnessStrip } from "../components/harness-strip";
import { Hero } from "../components/hero";
import { Hosts } from "../components/hosts";
import { Nav } from "../components/nav";
import { OpenSource } from "../components/open-source";

export default function Home() {
  return (
    <div className="hero-sky">
      <Nav />
      <main>
        <Hero />
        <HarnessStrip />
        <Features />
        <Hosts />
        <OpenSource />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

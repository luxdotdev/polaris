/** Where the site's links go. The download routes redirect to the latest Release's DMG or installer. */
export const repo = "https://github.com/luxdotdev/polaris";

export const links = {
  download: "/download/mac",
  /** `detect` lets the route pick the arch from Client hints or the User-Agent. */
  windows: {
    detect: "/download/windows",
    x64: "/download/windows?arch=x64",
    arm64: "/download/windows?arch=arm64",
  },
  source: repo,
  docs: `${repo}#readme`,
  changelog: `${repo}/releases`,
  license: `${repo}/blob/main/LICENSE`,
  attribution: `${repo}/blob/main/ATTRIBUTION.md`,
  brand: `${repo}/blob/main/DESIGN.md#brand`,
  pressKit: `${repo}/tree/main/design/assets/brand`,
} as const;

export const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Hosts", href: "#hosts" },
  { label: "Docs", href: links.docs },
  { label: "Changelog", href: links.changelog },
] as const;

export const site = {
  name: "Polaris",
  origin: "https://polaris.lux.dev",
  tagline: "The north star for your agents.",
  description:
    "Run Claude Code and Codex side by side, on any machine. Polaris shows what every agent is doing, calls you only when one is stuck, and puts the riskiest changes first.",
} as const;

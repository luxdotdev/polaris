import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import appleIcon from "../../../design/assets/app-icon/polaris.iconset/icon_256x256.png";
import icon from "../../../design/assets/app-icon/polaris.iconset/icon_32x32@2x.png";
import shot from "../../../design/assets/site/shot-orchestrate.png";
import { site } from "../components/links";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.origin),
  title: `${site.name}: ${site.tagline}`,
  description: site.description,
  icons: { icon: icon.src, apple: appleIcon.src },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: site.tagline,
    description: site.description,
    images: [
      { url: shot.src, width: shot.width, height: shot.height, alt: "The Polaris Orchestrator" },
    ],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0d1a" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfc" },
  ],
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

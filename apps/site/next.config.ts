import { join } from "node:path";
import { withBotId } from "botid/next/config";
import type { NextConfig } from "next";

// The monorepo root: @polaris/ui's styles and design/assets live outside apps/site.
const root = join(import.meta.dirname, "../..");

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@polaris/ui"],
  turbopack: { root },
  outputFileTracingRoot: root,
  images: { formats: ["image/avif", "image/webp"], qualities: [75, 85] },
  // Type checking runs in the monorepo's `typecheck` task (tsc -p .).
  typescript: { ignoreBuildErrors: true },
};

export default withBotId(config);

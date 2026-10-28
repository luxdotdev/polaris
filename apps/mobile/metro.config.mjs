// Expo's defaults find the Bun workspace root; `@polaris/sdk` resolves to its browser build,
// which opens the gateway with the global WebSocket instead of Node's socket.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import expoMetroConfig from "expo/metro-config";

const config = expoMetroConfig.getDefaultConfig(import.meta.dirname);

// Pierre's index pulls in Shiki and the DOM renderer; the app only parses patches (src/review/patch.ts).
const pierreParser = join(
  dirname(fileURLToPath(import.meta.resolve("@pierre/diffs"))),
  "utils",
  "parsePatchFiles.js"
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@pierre/diffs") return { type: "sourceFile", filePath: pierreParser };

  return context.resolveRequest(
    moduleName === "@polaris/sdk"
      ? { ...context, unstable_conditionNames: [...context.unstable_conditionNames, "browser"] }
      : context,
    moduleName,
    platform
  );
};

export default config;

// Expo's defaults find the Bun workspace root; `@polaris/sdk` resolves to its browser build,
// and `sodium-universal` to the native libsodium module (src/sodium/universal.ts).
import expoMetroConfig from "expo/metro-config";

const config = expoMetroConfig.getDefaultConfig(import.meta.dirname);

const sodium = new URL("src/sodium/universal.ts", import.meta.url).pathname;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "sodium-universal") return { type: "sourceFile", filePath: sodium };

  return context.resolveRequest(
    moduleName === "@polaris/sdk"
      ? { ...context, unstable_conditionNames: [...context.unstable_conditionNames, "browser"] }
      : context,
    moduleName,
    platform
  );
};

export default config;

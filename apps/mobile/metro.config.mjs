// Expo's defaults find the Bun workspace root; `@polaris/sdk` resolves to its browser build,
// which opens the gateway with the global WebSocket instead of Node's socket.
import expoMetroConfig from "expo/metro-config";

const config = expoMetroConfig.getDefaultConfig(import.meta.dirname);

config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    moduleName === "@polaris/sdk"
      ? { ...context, unstable_conditionNames: [...context.unstable_conditionNames, "browser"] }
      : context,
    moduleName,
    platform
  );

export default config;

import { Context } from "effect";
import { type LanguagePlatform, type HostId } from "@polaris/protocol";
import { hostPlatform, languagePlatformOf } from "../../platform/index.ts";

/** Transport supplies the actual Daemon Host; this is configuration, never request authentication. */
export class HostLanguageEnvironment extends Context.Service<
  HostLanguageEnvironment,
  { hostId: HostId; root: string; platform: typeof LanguagePlatform.Type | null }
>()("polaris/languages/HostLanguageEnvironment") {}

/** Unknown Linux runtime families remain unavailable instead of selecting a guessed artifact. */
export const currentLanguagePlatform = (): typeof LanguagePlatform.Type | null =>
  languagePlatformOf(hostPlatform());

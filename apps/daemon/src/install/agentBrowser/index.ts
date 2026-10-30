/**
 * The Host's agent-browser (ADR 0092): installed under `~/.polaris/tools/agent-browser/` on the
 * first `ensure`, never at start, so an idle Daemon downloads and runs nothing.
 */
import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { paths } from "../../paths.ts";
import { runtimePlatform } from "../../platform/index.ts";
import { type InstallOptions, type InstalledAgentBrowser, installAgentBrowser } from "./install.ts";

export { AGENT_BROWSER_VERSION } from "./pin.ts";

export type { InstalledAgentBrowser } from "./install.ts";

export class AgentBrowserUnavailable extends Schema.TaggedError<AgentBrowserUnavailable>()(
  "AgentBrowserUnavailable",
  { message: Schema.String }
) {}

/** One install at a time; a failed one is forgotten, so the next `ensure` tries again. */
const ensureOnce = (options: () => InstallOptions) => {
  let pending: Promise<InstalledAgentBrowser> | null = null;

  return Effect.tryPromise({
    try: () => {
      if (pending === null) {
        pending = installAgentBrowser(options());
        void pending.catch(() => {
          pending = null;
        });
      }

      return pending;
    },
    catch: (cause) =>
      new AgentBrowserUnavailable({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });
};

export class AgentBrowser extends Context.Service<
  AgentBrowser,
  {
    /** The installed binary, downloading and verifying the pinned build first if needed. */
    readonly ensure: Effect.Effect<InstalledAgentBrowser, AgentBrowserUnavailable>;
  }
>()("polaris/daemon/install/AgentBrowser") {
  static readonly layer = Layer.sync(AgentBrowser, () =>
    AgentBrowser.of({
      ensure: ensureOnce(() => ({
        root: join(paths().root, "tools", "agent-browser"),
        platform: runtimePlatform(),
      })),
    })
  );

  /** Tests and benches: a fixed install, or none. */
  static readonly layerAt = (installed: InstalledAgentBrowser | null) =>
    Layer.succeed(AgentBrowser)(
      AgentBrowser.of({
        ensure:
          installed === null
            ? Effect.fail(
                new AgentBrowserUnavailable({ message: "agent-browser is not installed" })
              )
            : Effect.succeed(installed),
      })
    );
}

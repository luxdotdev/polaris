// oxfmt resolves ignorePatterns against the config file's directory, so the
// shared style lives in packages/lint-config and the repo's paths live here.
import shared from "./packages/lint-config/oxfmt.json" with { type: "json" };

const { $schema: _schema, ...style } = shared;

export default {
  ...style,
  ignorePatterns: [
    ...style.ignorePatterns,
    ".agents/**",
    ".claude/**",
    ".codex/**",
    "design/**",
    "docs/**",
    "apps/daemon/src/harness/codex/generated/**",
    "packages/bench/baselines/**",
    "packages/lint-config/plugins/anti-slop/**",
    "tooling/lint/baseline.json",
  ],
};

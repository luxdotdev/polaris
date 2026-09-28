// oxlint JS plugin exposing one SonarJS rule, cognitive-complexity. The other
// SonarJS rules are deliberately not registered. See ../README.md.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const sonarjs = require("eslint-plugin-sonarjs");

export default {
  meta: { name: "sonarjs" },
  rules: {
    "cognitive-complexity": sonarjs.rules["cognitive-complexity"],
  },
};

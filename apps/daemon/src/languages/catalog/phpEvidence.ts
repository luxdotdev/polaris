import license from "./upstream-evidence/php-4287c3b7c293133dc59e92cb32a1aae899c4441ac6d64455c537c82070c84caa.txt" with { type: "text" };
import composerLicense from "./upstream-evidence/php-c8cce4b6b9729f264ffdf9296d505d63432497feeed1f586d1902b942197e024.txt" with { type: "text" };
import manifest from "./upstream-evidence/phpactor.phar.json";

/** Phpactor's release LICENSE and the Composer license bundled in its PHAR (ADR-0022). */
export const phpEvidence = {
  "phpactor.phar": {
    manifest,
    notices: {
      "notices/4287c3b7c293133dc59e92cb32a1aae899c4441ac6d64455c537c82070c84caa.txt": license,
      "notices/c8cce4b6b9729f264ffdf9296d505d63432497feeed1f586d1902b942197e024.txt":
        composerLicense,
    },
  },
};

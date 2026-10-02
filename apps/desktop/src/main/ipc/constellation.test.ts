import { expect, test } from "bun:test";
import { ConstellationFinding, ConstellationRejected, GitError } from "@polaris/protocol";
import { constellationError } from "./constellation.ts";

test("a refusal's findings become one line each, '<message>. <fix>'", () => {
  const error = new ConstellationRejected({
    findings: [
      new ConstellationFinding({
        code: "E-REVISION",
        message: "B1 changed since you looked.",
        fix: "Review it again at revision 4",
      }),
      new ConstellationFinding({ code: "E-SETTLED", message: "A2 is settled", fix: "Leave it" }),
    ],
    graph: null,
    revision: 4,
  });

  expect(constellationError(error)).toEqual({
    code: "ConstellationRejected",
    message: "B1 changed since you looked. Review it again at revision 4\nA2 is settled. Leave it",
  });
  expect(constellationError(new GitError({ cwd: "/x", message: "gone" }))).toEqual({
    code: "GitError",
    message: "gone",
  });
});

test("unsupported auto-mode dispatch displays the model and repair in the Client error", () => {
  const error = new ConstellationRejected({
    findings: [
      new ConstellationFinding({
        code: "E-HARNESS-PERMISSIONS",
        message: "Claude model haiku does not support the auto permission mode.",
        fix: "Choose a model that supports auto, or change the lead's permission mode.",
      }),
    ],
    graph: null,
    revision: 0,
  });

  expect(constellationError(error)).toEqual({
    code: "ConstellationRejected",
    message:
      "Claude model haiku does not support the auto permission mode. Choose a model that supports auto, or change the lead's permission mode.",
  });
});

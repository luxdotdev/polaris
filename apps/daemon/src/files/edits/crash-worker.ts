import { readFile } from "node:fs/promises";
import {
  LanguageEditAcceptance,
  LanguageEditProposal,
  LanguageOperationOutcome,
} from "@polaris/protocol";
import { Schema } from "effect";
import { createFileEditCoordinator } from "./index.ts";

const Input = Schema.Struct({
  journalRoot: Schema.String,
  owner: LanguageOperationOutcome.fields.owner,
  proposal: LanguageEditProposal,
  acceptance: LanguageEditAcceptance,
  point: Schema.Literals(["prepared", "intent", "mutation", "receipt"]),
});

if (import.meta.main) {
  const input = Schema.decodeUnknownSync(Input)(
    JSON.parse(await readFile(process.argv[2]!, "utf8"))
  );

  const coordinator = createFileEditCoordinator({
    journalRoot: input.journalRoot,
    authorize: async () => {},
    fault: async (point) => {
      if (point === input.point) process.kill(process.pid, "SIGKILL");
    },
  });

  await coordinator.accept(input.owner, input.proposal, input.acceptance, {
    durable: true,
    groupId: "draft-group",
  });
}

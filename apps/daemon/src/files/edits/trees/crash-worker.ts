import { readFile } from "node:fs/promises";
import {
  LanguageTreeEditAcceptance,
  LanguageTreeEditProposal,
  LanguageTreeOperationOutcome,
  LanguageTreeDraftReceipt,
} from "@polaris/protocol";
import { Schema } from "effect";
import { createTreeEditCoordinator } from "./index.ts";

const Input = Schema.Struct({
  journalRoot: Schema.String,
  owner: LanguageTreeOperationOutcome.fields.owner,
  proposal: LanguageTreeEditProposal,
  acceptance: LanguageTreeEditAcceptance,
  drafts: LanguageTreeDraftReceipt,
  point: Schema.Literals(["prepared", "intent", "mutation", "receipt"]),
});

if (import.meta.main) {
  const input = Schema.decodeUnknownSync(Input)(
    JSON.parse(await readFile(process.argv[2]!, "utf8"))
  );

  const coordinator = createTreeEditCoordinator({
    journalRoot: input.journalRoot,
    authorize: async () => {},
    authorizeRecovery: async () => {},
    fault: async (point) => {
      if (point === input.point) process.kill(process.pid, "SIGKILL");
    },
  });

  await coordinator.accept(input.owner, input.proposal, input.acceptance, input.drafts);
}

import * as P from "@polaris/protocol";
import { Match } from "effect";

export const languageEventContext = (event: P.LanguageContextEvent): P.LanguageContextIdentity =>
  Match.value(event).pipe(
    Match.tag("Snapshot", (value) => value.context),
    Match.tag("RuntimeChanged", (value) => value.context),
    Match.tag("Synchronized", (value) => value.ack.context),
    Match.tag("CapabilitiesChanged", (value) => value.context),
    Match.tag("Diagnostics", (value) => value.diagnostics.context),
    Match.tag("ServerRequest", (value) => value.request.context),
    Match.tag("Progress", (value) => value.progress.context),
    Match.tag("Log", (value) => value.context),
    Match.tag("Invalidated", (value) => value.context),
    Match.exhaustive
  );

export const languageProposalResources = (proposal: P.LanguageEditProposal): boolean =>
  proposal.edit.documentChanges?.some((change) => "kind" in change) ?? false;

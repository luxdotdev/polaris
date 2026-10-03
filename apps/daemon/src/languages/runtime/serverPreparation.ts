import type {
  LanguageEditProposal,
  LanguagePositionEncoding,
  LanguageWorkspaceEdit,
  LanguageTreeEditProposal,
} from "@polaris/protocol";
import type { LaunchAdmissionRequest } from "./launchAdmission.ts";
import type { AcknowledgmentOwners } from "./acknowledgmentOwners.ts";
import type { Entry } from "./types.ts";

/** Private runtime access is pinned to the actual entry and its owned admission lifetime. */
export interface ServerPreparationAccess {
  request: LaunchAdmissionRequest;
  encoding: () => typeof LanguagePositionEncoding.Type | null;
  fence: (fence: LanguageEditProposal["fence"]) => void;
  document: AcknowledgmentOwners["document"];
  acknowledgment: AcknowledgmentOwners["read"];
}

export type PrepareServerEdit = (
  edit: LanguageWorkspaceEdit,
  proposal: LanguageEditProposal,
  access: ServerPreparationAccess
) => Promise<LanguageEditProposal | LanguageTreeEditProposal>;

export const bindServerPreparation = (
  entry: Entry,
  acknowledgments: AcknowledgmentOwners,
  request: LaunchAdmissionRequest,
  prepare: PrepareServerEdit | undefined
) => {
  if (prepare === undefined) return undefined;

  const documents = entry.documents;

  const access: ServerPreparationAccess = {
    request,
    encoding: () => entry.capabilities?.positionEncoding ?? null,
    fence: (fence) => {
      if (entry.documents !== documents || !request.isCurrent() || request.signal.aborted)
        throw new Error("Server edit context was replaced");
      documents.fence(fence);
    },
    document: (...args) => acknowledgments.document(...args),
    acknowledgment: (...args) => acknowledgments.read(...args),
  };

  return (edit: LanguageWorkspaceEdit, proposal: LanguageEditProposal) =>
    prepare(edit, proposal, access);
};

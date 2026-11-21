/** Session authority stays with the user; the scope is explicit on each answer (ADR 0119). */
import { ApprovalDecision, type ApprovalRequest } from "@polaris/protocol";
import { SettingsButton } from "@polaris/ui";

export const GrantApprovalCard = ({
  request,
  onRespond,
  theirs,
}: {
  readonly request: ApprovalRequest;
  readonly onRespond: (decision: ApprovalDecision) => void;
  readonly theirs: boolean;
}) => (
  <div
    className="rounded-card border-hairline bg-surface-raised flex flex-col gap-3 border p-3.5"
    data-testid="grant-approval"
  >
    <p className="text-heading-sm text-text-strong">{request.title}</p>
    <p className="text-caption text-text-subtle break-words whitespace-pre-wrap">
      {request.detail}
    </p>
    <div className="flex flex-wrap gap-1.5">
      <SettingsButton
        variant="primary"
        disabled={theirs}
        onClick={() => onRespond(ApprovalDecision.cases.Allow.make({ remember: false }))}
      >
        Allow once
      </SettingsButton>
      {request.grant?.rememberable && !theirs ? (
        <>
          <SettingsButton
            onClick={() =>
              onRespond(
                ApprovalDecision.cases.Allow.make({ remember: true, grantScope: "session" })
              )
            }
          >
            Always for this session
          </SettingsButton>
          <SettingsButton
            onClick={() =>
              onRespond(
                ApprovalDecision.cases.Allow.make({ remember: true, grantScope: "workspace" })
              )
            }
          >
            Always for this workspace
          </SettingsButton>
        </>
      ) : null}
      <SettingsButton
        variant="quiet"
        disabled={theirs}
        onClick={() => onRespond(ApprovalDecision.cases.Deny.make({ reason: null }))}
      >
        Deny
      </SettingsButton>
    </div>
    <p className="text-caption text-text-faint">
      {theirs
        ? "Only the owner can grant session authority."
        : request.grant?.rememberable
          ? "This allows the action on this host. Workspace choices apply to every session in this workspace."
          : "An action outside the starter chain needs approval each time."}
    </p>
  </div>
);

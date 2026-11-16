/**
 * The host page's Desktop apps card and notice (DESIGN.md, Settings → Hosts, Desktop apps):
 * the desktop apps this host lets act as the user, each revoked in place, the ones asking with
 * their code, and what this app is told while it isn't one of them.
 */
import {
  SettingsButton,
  SettingsCard,
  SettingsConfirmRow,
  SettingsRow,
  SettingsWell,
} from "@polaris/ui";
import type { MachineView } from "../../../shared/api.ts";
import type { UserAccessRequestView } from "../../../shared/userAccessContract.ts";
import { allowRequest, denyRequest, revokeApp } from "./actions.ts";
import {
  cardAside,
  enrolledCaption,
  noticeOf,
  onlyAppCaption,
  revokeConsequence,
} from "./model.ts";
import { useUserAccess } from "./store.ts";

const RequestRow = ({
  machine,
  request,
}: {
  readonly machine: MachineView;
  readonly request: UserAccessRequestView;
}) => (
  <SettingsRow
    title={`${request.label} is asking`}
    caption={
      <>
        Allow it only if it shows <span className="font-mono">{request.code}</span>
      </>
    }
  >
    <SettingsButton variant="ghost" onClick={() => void denyRequest(machine.key, request)}>
      Deny
    </SettingsButton>
    <SettingsButton onClick={() => void allowRequest(machine.key, request)}>Allow</SettingsButton>
  </SettingsRow>
);

/** Nothing unless this desktop app holds user access on the host: only then does it see the list. */
export const DesktopAppsCard = ({
  machine,
  now,
}: {
  readonly machine: MachineView;
  readonly now: number;
}) => {
  const state = useUserAccess(machine.key);

  if (state === undefined || state.standing !== "held") return null;

  return (
    <SettingsCard
      title="Desktop apps"
      aside={cardAside(state)}
      status="Only these approve, send turns and start agent sessions here"
      data-testid="desktop-apps-card"
    >
      <SettingsWell>
        {state.requests.map((request) => (
          <RequestRow key={request.id} machine={machine} request={request} />
        ))}
        {state.enrolled.map((app) =>
          // The host refuses to revoke its last one, so the only row offers no Revoke.
          state.enrolled.length === 1 ? (
            <SettingsRow key={app.id} title={app.label} caption={onlyAppCaption(app, now)} />
          ) : (
            <SettingsConfirmRow
              key={app.id}
              title={app.label}
              caption={enrolledCaption(app, now)}
              action="Revoke"
              actionVariant="secondary"
              consequence={revokeConsequence(app, machine.label)}
              confirm={`Revoke ${app.label}`}
              onConfirm={() => void revokeApp(machine.key, app)}
            />
          )
        )}
      </SettingsWell>
    </SettingsCard>
  );
};

/** While this desktop app waits, or was denied: one sentence, the fact, and its code. */
export const UserAccessNotice = ({ machine }: { readonly machine: MachineView }) => {
  const notice = noticeOf(useUserAccess(machine.key), machine.label);

  if (notice === null) return null;

  return (
    <div className="gap-row-x flex flex-col" data-testid="user-access-notice">
      <p className="text-body text-text-default">
        {notice.title}. {notice.body}
      </p>
      {notice.code === null ? null : (
        <pre className="border-hairline bg-surface-sunken text-code-inline text-text-default py-row-x rounded-row border px-3 font-mono leading-[18px]">
          {notice.code}
        </pre>
      )}
    </div>
  );
};

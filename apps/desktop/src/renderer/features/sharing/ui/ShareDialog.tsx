/**
 * The share sheet (Paper SS3; DESIGN.md, Shared Sessions "Share"): signed out, why sharing needs
 * a Polaris account; signed in, the invite form, who has access and the share log.
 */
import type { SessionId } from "@polaris/protocol";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@polaris/ui";
import { useHost } from "../../session/hooks.ts";
import { usePolarisAccounts } from "../../accounts/index.ts";
import { polaris } from "../../bridge.ts";
import { ShareForm } from "./ShareForm.tsx";

export interface ShareDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly workspaceId: string;
  readonly title: string;
}

const SignedOut = ({ hostLabel }: { readonly hostLabel: string }) => (
  <>
    <DialogHeader>
      <DialogTitle>Share this session</DialogTitle>
      <DialogDescription>
        Sharing needs a Polaris account, so the people you invite know it's you. Working alone on
        your own hosts never does.
      </DialogDescription>
    </DialogHeader>
    <div className="flex flex-col gap-3 px-5 pb-5">
      <p className="text-body text-text-subtle">
        Your session stays on {hostLabel}; teammates connect to it through the relay.
      </p>
      <Button
        variant="primary"
        data-testid="share-sign-in"
        onClick={() => void polaris().request("accounts.signIn.start", {})}
      >
        Sign in with GitHub
      </Button>
      <p className="text-caption text-text-subtle">
        Signs in to Polaris Cloud. Use your own server in Settings → Polaris accounts.
      </p>
    </div>
  </>
);

export const ShareDialog = ({ open, onClose, ...target }: ShareDialogProps) => {
  const view = usePolarisAccounts();
  const host = useHost(target.hostKey);
  const accounts = (view?.accounts ?? []).filter((a) => a.signedOutAt === null);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showClose
        className={accounts.length === 0 ? "w-[400px]" : "max-h-[calc(100%-64px)] w-[520px]"}
        data-testid="share-sheet"
      >
        {accounts.length === 0 ? (
          <SignedOut hostLabel={host?.label ?? "your host"} />
        ) : (
          <ShareForm
            {...target}
            accounts={accounts}
            workspaces={view?.workspaces ?? {}}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

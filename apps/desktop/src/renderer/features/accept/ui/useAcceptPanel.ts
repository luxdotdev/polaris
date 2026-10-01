/**
 * The accept popover's state: the Daemon's plan and drafted message for the Turns chosen,
 * the user's edits, the branch (Settings → Sessions, per Workspace), and the run.
 */
import {
  AcceptBranch,
  type AcceptDraft,
  type AcceptPlan,
  type SessionId,
  type TurnId,
} from "@polaris/protocol";
import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import {
  type AcceptBranchChoice,
  acceptBranchFor,
  acceptBranchMode,
  workspaceKeyOf,
} from "../../../../shared/acceptBranch.ts";
import { parseGitHubRemote, repoKey } from "../../../../shared/github.ts";
import type { Plain } from "../../../store/plain.ts";
import { usePulls } from "../../pulls/store.ts";
import { branchFromPrompt } from "../../session/model/newSession.ts";
import { useSettings } from "../../settings/store.ts";
import { acceptPorts, fetchDraft, fetchPlan } from "../data/ports.ts";
import { acceptEnd, type AcceptEnd } from "../model/action.ts";
import {
  type AcceptOutcome,
  type AcceptProgress,
  type AcceptRequest,
  type AcceptStep,
  NO_PROGRESS,
  runAccept,
} from "../model/flow.ts";

export interface PanelSession {
  readonly hostKey: string;
  readonly sessionId: SessionId;
  readonly workspaceId: string;
  readonly title: string;
  readonly linked: boolean;
}

type Loaded<A> =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly value: A }
  | { readonly kind: "failed"; readonly message: string };

export interface Fields {
  readonly title: string;
  readonly body: string;
  readonly prTitle: string;
  readonly prBody: string;
  readonly turnTitles: ReadonlyArray<string>;
}

export type RunState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly step: AcceptStep }
  | (Extract<AcceptOutcome, { ok: false }> & { readonly kind: "failed" })
  | { readonly kind: "done"; readonly progress: AcceptProgress };

const LOADING = { kind: "loading" } as const;

const IDLE: RunState = { kind: "idle" };

/** Runs by session and Turn: the popover remounts as the session changes under it. */
const runs = createStore<Readonly<Record<string, RunState>>>(() => ({}));

type Fetch<A> = (
  hostKey: string,
  sessionId: SessionId,
  throughTurnId: TurnId
) => Promise<{ ok: true; value: A } | { ok: false; error: { message: string } }>;

/** One request per (session, Turn); a stale answer is never shown for a newer choice. */
const useFetched = <A>(
  fetch: Fetch<A>,
  hostKey: string,
  sessionId: SessionId,
  throughTurnId: TurnId
): Loaded<A> => {
  const key = `${hostKey}/${sessionId}/${throughTurnId}`;
  const [state, setState] = useState<{ key: string; loaded: Loaded<A> }>({ key, loaded: LOADING });

  useEffect(() => {
    let live = true;

    void fetch(hostKey, sessionId, throughTurnId).then((result) => {
      if (!live) return;
      setState({
        key: `${hostKey}/${sessionId}/${throughTurnId}`,
        loaded: result.ok
          ? { kind: "ready", value: result.value }
          : { kind: "failed", message: result.error.message },
      });
    });

    return () => {
      live = false;
    };
  }, [fetch, hostKey, sessionId, throughTurnId]);

  return state.key === key ? state.loaded : LOADING;
};

const fieldsOf = (draft: Plain<AcceptDraft>): Fields => ({
  title: draft.title,
  body: draft.body,
  prTitle: draft.prTitle,
  prBody: draft.prBody,
  turnTitles: draft.turnTitles,
});

export const useAcceptPanel = (session: PanelSession, throughTurnId: TurnId) => {
  const { hostKey, sessionId } = session;
  const key = `${hostKey}/${sessionId}/${throughTurnId}`;
  const plan = useFetched(fetchPlan, hostKey, sessionId, throughTurnId);
  const draft = useFetched(fetchDraft, hostKey, sessionId, throughTurnId);
  const prefs = useSettings((s) => s.sessions);
  const repos = usePulls((s) => s.list?.repos);
  const [edits, setEdits] = useState<{ key: string; fields: Fields } | null>(null);
  const [branchEdit, setBranchEdit] = useState<AcceptBranchChoice | null>(null);
  const [perTurn, setPerTurn] = useState(false);
  const [revertLater, setRevertLater] = useState(false);
  const run = useStore(runs, (all) => all[key] ?? IDLE);
  const setRun = (next: RunState) => runs.setState({ [key]: next });

  const ready = plan.kind === "ready" ? plan.value : null;

  const fields =
    edits?.key === key ? edits.fields : draft.kind === "ready" ? fieldsOf(draft.value) : null;

  const defaultChoice = useMemo(
    () =>
      ready === null
        ? null
        : acceptBranchFor(
            acceptBranchMode(prefs, workspaceKeyOf(hostKey, session.workspaceId)),
            ready,
            branchFromPrompt(session.title, sessionId, prefs.branchPrefix)
          ),
    [ready, prefs, hostKey, session.workspaceId, session.title, sessionId]
  );

  const choice = ready?.worktree === true ? defaultChoice : (branchEdit ?? defaultChoice);
  const repo = ready?.remote ? parseGitHubRemote(ready.remote.url) : null;

  const access =
    repo === null ? undefined : repos?.find((r) => r.repo.toLowerCase() === repoKey(repo));

  const end: AcceptEnd | null =
    ready === null || choice === null
      ? null
      : acceptEnd({
          remote: ready.remote,
          repo: access?.state === "ok" || access === undefined ? repo : null,
          choice,
          current: ready.branch,
          defaultBranch: ready.defaultBranch,
          linked: session.linked,
        });

  const request = (): AcceptRequest | null => {
    if (ready === null || fields === null || choice === null || end === null) return null;

    return {
      sessionId,
      throughTurnId,
      revertLaterTurns: revertLater && ready.laterTurns > 0,
      branch:
        choice.kind === "create"
          ? AcceptBranch.cases.Create.make({ name: choice.name })
          : AcceptBranch.cases.Current.make({}),
      granularity: perTurn && ready.turns.length > 1 ? "per-turn" : "single",
      title: fields.title,
      body: fields.body,
      turnTitles: fields.turnTitles,
      push: end !== "commit",
      pull:
        end === "pull" && repo !== null
          ? {
              repo,
              workspace: { hostKey, workspaceId: session.workspaceId },
              title: fields.prTitle.trim() || fields.title,
              body: fields.prBody,
              draft: false,
            }
          : null,
    };
  };

  const submit = async () => {
    const next = request();

    if (next === null || run.kind === "running") return;
    const from = run.kind === "failed" ? run.progress : NO_PROGRESS;

    const outcome = await runAccept(
      next,
      acceptPorts(hostKey),
      (step) => setRun({ kind: "running", step }),
      from
    );

    setRun(
      outcome.ok ? { kind: "done", progress: outcome.progress } : { ...outcome, kind: "failed" }
    );
  };

  return {
    plan,
    draft,
    fields,
    setFields: (patch: Partial<Fields>) =>
      fields !== null && setEdits({ key, fields: { ...fields, ...patch } }),
    choice,
    setChoice: setBranchEdit,
    perTurn,
    setPerTurn,
    revertLater,
    setRevertLater,
    end,
    login: access?.login ?? null,
    repo,
    run,
    submit,
    canSubmit: request() !== null && fields !== null && fields.title.trim() !== "",
  };
};

export type AcceptPanelState = ReturnType<typeof useAcceptPanel>;

export type { Plain, AcceptPlan };

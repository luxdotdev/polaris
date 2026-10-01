/**
 * The checkout menu's first section, by state (Paper R4): the new commits and Update, a
 * blocker and its fix, a fetch under way, or where a repository no Workspace holds can be cloned.
 */
import { Button } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { OpenPull } from "../../../../../shared/api.ts";
import type { CompareView } from "../../../../../shared/github.ts";
import { age } from "../../../../shell/copy.ts";
import type { useShellActions } from "../../../../shell/hooks.ts";
import { type Held, runFix, updateCheckout } from "../actions.ts";
import { type CloneTarget, cloneOn } from "../clone.ts";
import type { BlockView } from "../model/chip.ts";
import { shortSha } from "../model/chip.ts";
import {
  Group,
  Heading,
  HOVER,
  Primary,
  ROW,
  RowGlyph,
  Section,
  Well,
  WellLine,
} from "./menuParts.tsx";

type Nav = ReturnType<typeof useShellActions>;

const commitsTitle = (count: number | null, branch: string | null, rewritten: boolean) => {
  const on = branch === null ? "" : ` on ${branch}`;

  if (rewritten)
    return branch === null ? "The branch was force-pushed" : `${branch} was force-pushed`;

  if (count === null) return `New commits${on}`;

  return `${count} new ${count === 1 ? "commit" : "commits"}${on}`;
};

const updateCaption = (count: number | null, rewritten: boolean) => {
  if (rewritten || count === null) return "then rerun the risk summary on the new changes only";

  return `then rerun the risk summary on ${count === 1 ? "this commit" : `these ${count} commits`} only`;
};

const CommitRows = ({ compare, now }: { readonly compare: CompareView; readonly now: number }) => {
  const more = compare.total - compare.commits.length;

  return (
    <Well>
      {compare.commits.map((c) => (
        <div key={c.oid} data-testid="checkout-commit" className="gap-gap flex items-center">
          <span className="text-text-subtle shrink-0 font-mono text-[11px] leading-4">
            {shortSha(c.oid).slice(0, 6)}
          </span>
          <span className="text-caption text-text-default min-w-0 flex-1 truncate">
            {c.headline}
          </span>
          {c.date !== null && (
            <span className="text-caption text-text-subtle shrink-0">{age(c.date, now)}</span>
          )}
        </div>
      ))}
      {more > 0 && <p className="text-caption text-text-subtle">and {more} more</p>}
    </Well>
  );
};

export const NewCommits = ({
  held,
  compare,
  branch,
  onDone,
}: {
  readonly held: Held;
  readonly compare: CompareView | null;
  readonly branch: string | null;
  readonly onDone: () => void;
}) => {
  const rewritten = compare?.status === "diverged";
  const count = compare === null ? null : compare.total;

  return (
    <Section testId="checkout-menu-new-commits">
      <Heading
        title={commitsTitle(count, branch, rewritten)}
        fact={`Your checkout on ${held.hostLabel} is at ${shortSha(held.checkout.head)}`}
      />
      {compare !== null && compare.commits.length > 0 && (
        <CommitRows compare={compare} now={Date.now()} />
      )}
      <Primary
        testId="checkout-update"
        label="Update checkout"
        after={updateCaption(count, rewritten)}
        onClick={() => {
          void updateCheckout(held);
          onDone();
        }}
      />
    </Section>
  );
};

export const Blocked = ({
  block,
  held,
  pull,
  nav,
  askFirst,
  onDone,
}: {
  readonly block: BlockView;
  readonly held: Held;
  readonly pull: OpenPull;
  readonly nav: Nav;
  readonly askFirst: boolean;
  readonly onDone: () => void;
}) => {
  const [asking, setAsking] = useState(askFirst);

  useEffect(() => {
    if (askFirst) setAsking(true);
  }, [askFirst]);

  const fix = () => {
    runFix(block.fix, held, pull, nav);
    onDone();
  };

  return (
    <Section testId="checkout-menu-blocked">
      <Heading title={block.title} fact={block.fact} />
      {block.evidence.length > 0 && (
        <Well>
          {block.evidence.map((line) => (
            <WellLine key={line} text={line} />
          ))}
        </Well>
      )}
      {asking && block.confirm !== null ? (
        <div className="gap-row-x flex items-center">
          <Button size="sm" variant="danger" data-testid="checkout-fix-confirm" onClick={fix}>
            {block.fix.label}
          </Button>
          <p className="text-caption text-text-subtle flex-1">{block.confirm}</p>
          <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Keep them
          </Button>
        </div>
      ) : (
        <Primary
          testId="checkout-fix"
          label={block.fix.label}
          after={null}
          onClick={() => (block.confirm === null ? fix() : setAsking(true))}
        />
      )}
    </Section>
  );
};

export const Fetching = ({ title }: { readonly title: string }) => (
  <Section testId="checkout-menu-fetching">
    <Heading
      title={title}
      fact="Fetches use the host’s own git credentials, not your GitHub sign-in in Polaris."
    />
  </Section>
);

/** Not on any host: what cloning does, then a row per connected Host to clone on. */
export const CloneOn = ({
  pull,
  targets,
  codeHost,
  failed,
  onDone,
}: {
  readonly pull: OpenPull;
  readonly targets: ReadonlyArray<CloneTarget>;
  readonly codeHost: string;
  readonly failed: { readonly host: string; readonly message: string } | null;
  readonly onDone: () => void;
}) => (
  <>
    <Section testId="checkout-menu-clone">
      <Heading
        title={failed === null ? "No workspace has this repo" : `Couldn’t clone on ${failed.host}`}
        fact={`Cloning adds ~/code/${pull.repo.name} as a workspace on the host you pick, with that host’s git credentials.`}
      />
      {failed !== null && (
        <Well>
          <WellLine text={failed.message} />
        </Well>
      )}
    </Section>
    <Group title="Clone on" testId="checkout-clone-hosts">
      {targets.length === 0 ? (
        <p className="text-caption text-text-subtle px-gap pb-1">No host is connected.</p>
      ) : (
        targets.map((target) => (
          <button
            key={target.hostKey}
            type="button"
            data-testid="checkout-clone-host"
            data-host={target.hostKey}
            className={`${ROW} ${HOVER}`}
            onClick={() => {
              void cloneOn(target, pull, codeHost);
              onDone();
            }}
          >
            <RowGlyph />
            <span className="text-body text-text-default shrink-0">{target.label}</span>
            <span className="text-caption text-text-subtle min-w-0 flex-1 truncate">
              ~/code/{pull.repo.name}
            </span>
          </button>
        ))
      )}
    </Group>
  </>
);

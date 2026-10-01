/**
 * The author's description (Paper R9 ATI-0), as Markdown; an empty one says so, and on the
 * viewer's own pull request points at the walkthrough that can stand in for it.
 */
import type { PersonView } from "../model/types.ts";
import { ReviewMarkdown } from "./markdown/index.tsx";
import { reviewLinks } from "./links.tsx";
import { Card, CardHead, ExternalLink, Mark } from "./parts.tsx";

export interface DescriptionProps {
  readonly subjectKey: string;
  readonly author: PersonView | null;
  readonly body: string;
  readonly own: boolean;
  readonly url: string;
  readonly paths: ReadonlyArray<string>;
}

export const Description = ({ subjectKey, author, body, own, url, paths }: DescriptionProps) => {
  if (body.trim() === "") {
    return (
      <section
        data-testid="description-empty"
        className="rounded-row border-hairline gap-gap pr-panel flex items-center border border-dashed py-3 pl-3.5"
      >
        <Mark person={author} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-text-strong font-medium">
            This pull request has no description
          </span>
          {own && (
            <span className="text-caption text-text-subtle">
              Reviewers see an empty description on GitHub. The walkthrough below can stand in for
              it.
            </span>
          )}
        </div>
        {own && <ExternalLink href={url}>Write on GitHub</ExternalLink>}
      </section>
    );
  }

  return (
    <Card data-testid="description">
      <CardHead ruled>
        <Mark person={author} />
        <span className="text-body text-text-strong font-medium">{author?.login ?? "ghost"}</span>
        <span className="text-caption text-text-subtle flex-1">opened this pull request</span>
        <span className="text-caption text-text-subtle">Description</span>
      </CardHead>
      <div className="px-panel py-3.5">
        <ReviewMarkdown markdown={body} paths={paths} renderLink={reviewLinks(subjectKey)} />
      </div>
    </Card>
  );
};

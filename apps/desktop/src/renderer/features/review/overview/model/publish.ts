/**
 * The walkthrough as a pull request's description: finding links become file links (a
 * finding means nothing on GitHub), and a credit line names who wrote it.
 */
export interface FindingRef {
  readonly id: string;
  readonly path: string;
  readonly line: number;
}

export const publishedBody = (
  markdown: string,
  findings: ReadonlyArray<FindingRef>,
  by: string
): string => {
  const body = markdown.replace(
    /\[([^\]]+)\]\(finding:([^)\s]+)\)/g,
    (_, title: string, id: string) => {
      const finding = findings.find((f) => f.id === id);

      return finding === undefined ? title : `${title} (\`${finding.path}:${finding.line}\`)`;
    }
  );

  return `${body.trimEnd()}\n\n_Walkthrough by Polaris (${by})_\n`;
};

/** What the publish action offers: first publish, republish after new commits, or nothing. */
export type PublishOffer = "publish" | "republish" | null;

export const publishOffer = (
  own: boolean,
  published: { readonly head: string; readonly matches?: boolean } | null,
  head: string
): PublishOffer => {
  if (!own) return null;

  if (published === null) return "publish";

  // Someone edited the description since: Polaris doesn't offer to overwrite it.
  return published.head === head || published.matches === false ? null : "republish";
};
